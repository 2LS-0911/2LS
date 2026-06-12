import json
import os
import sys
import time
import voyageai
from pymongo import MongoClient
from dotenv import load_dotenv

sys.stdout = sys.stderr

load_dotenv(r"C:\dia\manufacturing-car-manual-RAG\backend\.env")

VOYAGE_API_KEY = os.getenv("VOYAGE_API_KEY")
MONGODB_URI = os.getenv("MONGODB_URI")
DATABASE_NAME = os.getenv("DATABASE_NAME", "autodiag")
COLLECTION_NAME = "atoms"

BATCH_SIZE = 8       # 8 atoms * ~1000 tokens = ~8K TPM per call (under 10K limit)
RATE_LIMIT_DELAY = 21  # seconds between Voyage API calls (keeps under 3 RPM)

def main():
    print("Connecting to MongoDB Atlas...")
    client = MongoClient(MONGODB_URI, serverSelectionTimeoutMS=10000)
    client.admin.command('ping')
    print("Connected!")

    collection = client[DATABASE_NAME][COLLECTION_NAME]

    total_in_db = collection.count_documents({})
    already_done = collection.count_documents({"embedding": {"$exists": True}})
    print(f"DB state: {total_in_db} docs total, {already_done} with embeddings")

    # Fetch all existing IDs in ONE query — no per-atom lookups
    print("Fetching existing IDs from DB...")
    existing_ids = set(
        doc["id"] for doc in collection.find(
            {"embedding": {"$exists": True}},
            {"id": 1, "_id": 0}
        )
    )
    print(f"Loaded {len(existing_ids)} existing IDs into memory.")

    print("Initializing Voyage AI...")
    vo = voyageai.Client(api_key=VOYAGE_API_KEY)

    atoms_path = r"C:\dia\output\atoms_clean.jsonl"
    print(f"Reading {atoms_path}...")
    atoms = []
    with open(atoms_path, "r", encoding="utf-8") as f:
        for line in f:
            if line.strip():
                atoms.append(json.loads(line))
    print(f"Loaded {len(atoms)} atoms.")

    # Filter to only new atoms locally — instant, no DB queries
    new_atoms = [a for a in atoms if a.get("id", "") not in existing_ids]
    print(f"Need to embed: {len(new_atoms)} new atoms (skipping {len(atoms) - len(new_atoms)} already done)")

    if not new_atoms:
        print("Nothing to do — all atoms already embedded!")
        return

    total_uploaded = 0
    total_batches = (len(new_atoms) + BATCH_SIZE - 1) // BATCH_SIZE

    for batch_num, i in enumerate(range(0, len(new_atoms), BATCH_SIZE), 1):
        batch = new_atoms[i:i + BATCH_SIZE]

        texts = []
        for atom in batch:
            title = atom.get("title", "")
            content = atom.get("content", "")
            symptoms = ", ".join(atom.get("symptoms", []))
            dtc = ", ".join(atom.get("dtc_codes", []))
            vehicle = atom.get("vehicle", {})
            v_str = (
                f"{vehicle.get('make', '')} {vehicle.get('model', '')}"
                if isinstance(vehicle, dict) else str(vehicle)
            )
            text = f"Title: {title}\nVehicle: {v_str}\nSymptoms: {symptoms}\nDTC: {dtc}\nContent: {content}"
            texts.append(text[:4000])

        success = False
        retries = 5
        while not success and retries > 0:
            try:
                print(f"[{batch_num}/{total_batches}] Embedding {len(batch)} atoms...")
                result = vo.embed(texts, model="voyage-3", input_type="document")
                embeddings = result.embeddings

                for idx, atom in enumerate(batch):
                    atom["embedding"] = embeddings[idx]
                    collection.replace_one({"id": atom["id"]}, atom, upsert=True)

                total_uploaded += len(batch)
                pct = total_uploaded / len(new_atoms) * 100
                print(f"  OK! Uploaded: {total_uploaded}/{len(new_atoms)} ({pct:.1f}%). Waiting {RATE_LIMIT_DELAY}s...")
                time.sleep(RATE_LIMIT_DELAY)
                success = True

            except Exception as e:
                retries -= 1
                msg = str(e)
                if "rate" in msg.lower() or "429" in msg:
                    wait = 65
                    print(f"  Rate limit! Waiting {wait}s... (retries: {retries})")
                else:
                    wait = 30
                    print(f"  Error: {msg[:120]}. Waiting {wait}s... (retries: {retries})")
                time.sleep(wait)

        if not success:
            print(f"FAILED batch {batch_num} after all retries. Stopping.")
            break

    final_count = collection.count_documents({"embedding": {"$exists": True}})
    print(f"\nDONE! Uploaded: {total_uploaded} new. Total in DB: {final_count}/{len(atoms)}")

if __name__ == "__main__":
    main()
