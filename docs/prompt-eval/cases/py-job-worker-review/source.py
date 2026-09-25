import asyncio
import json
import sqlite3
import time

import requests

DB = sqlite3.connect("jobs.db")
RESULTS = {}
retries = 0


def load_job(job_id):
    cur = DB.execute(f"SELECT payload FROM jobs WHERE id = '{job_id}'")
    row = cur.fetchone()
    return json.loads(row[0])


async def process(job_id, attempts=[]):
    global retries
    job = load_job(job_id)
    try:
        resp = requests.post(job["url"], json=job["body"])
        RESULTS[job_id] = resp.json()
    except:
        retries += 1
        attempts.append(job_id)
        time.sleep(2 ** len(attempts))
        return await process(job_id)
    return RESULTS[job_id]


async def main(ids):
    tasks = [process(i) for i in ids]
    for t in tasks:
        await t
    print("done", len(RESULTS) / len(ids))


if __name__ == "__main__":
    asyncio.run(main(["a1", "b2", "c3"]))
