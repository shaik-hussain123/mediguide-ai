
import asyncio
from typing import List, Dict, Any
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv()
from os import getenv

MONGODB_URL = getenv("MONGODB_URL", "mongodb://localhost:27017")
DATABASE_NAME = getenv("DATABASE_NAME", "mediguide_db")

class SourceConflictEngine:
    def __init__(self):
        self.client = AsyncIOMotorClient(MONGODB_URL)
        self.db = self.client[DATABASE_NAME]

    async def detect_conflicts(self, med_name: str) -> List[Dict[str, Any]]:
        conflicts = []
        # Check dosage conflicts
        meds = await self.db["medications"].find({"name": med_name}).to_list(length=100)
        unique_dosages = set()
        dosage_sources = []
        for med in meds:
            dosage = (med.get("safe_min"), med.get("safe_max"))
            if dosage in unique_dosages and med.get("sourceName") != dosage_sources[-1][0]:
                conflicts.append({
                    "type": "dosage",
                    "med": med_name,
                    "conflict": f"Dosage mismatch between {dosage_sources[-1][0]} and {med.get('sourceName')}",
                    "severity": "MODERATE",
                    "sources": [
                        {"source": dosage_sources[-1][0], "evidenceTier": dosage_sources[-1][1]},
                        {"source": med.get("sourceName"), "evidenceTier": med.get("evidenceTier")}
                    ]
                })
            unique_dosages.add(dosage)
            dosage_sources.append((med.get("sourceName"), med.get("evidenceTier")))

        # Check interaction conflicts
        interactions = await self.db["interactions"].find({"$or": [{"med_a": med_name}, {"med_b": med_name}]}).to_list(length=100)
        inter_map = {}
        for inter in interactions:
            other = inter["med_b"] if inter["med_a"] == med_name else inter["med_a"]
            key = (med_name, other)
            if key in inter_map and inter_map[key]["severity"] != inter["severity"]:
                conflicts.append({
                    "type": "interaction",
                    "med_a": med_name,
                    "med_b": other,
                    "conflict": f"Interaction severity mismatch: {inter_map[key]['severity']} vs {inter['severity']}",
                    "severity": "HIGH",
                    "sources": [
                        {"source": inter_map[key]["source"], "evidenceTier": inter_map[key]["evidenceTier"]},
                        {"source": inter["evidence"]["sourceName"], "evidenceTier": inter["evidence"]["evidenceTier"]}
                    ]
                })
            else:
                inter_map[key] = {
                    "severity": inter["severity"],
                    "source": inter["evidence"]["sourceName"],
                    "evidenceTier": inter["evidence"]["evidenceTier"]
                }

        # Store conflicts
        if conflicts:
            await self.db["source_conflicts"].insert_many(conflicts)

        return conflicts
