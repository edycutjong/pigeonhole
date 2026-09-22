import csv, json
rows = list(csv.DictReader(open("bench/many.csv")))
single = json.load(open("bench/results.json"))["movingSweepGas"]["p50"]  # one sweep(salt) per tx, N=25
out = {"network": "arc-mainnet", "chainId": 5042, "factory": "0x942b8c102e73aeea1a652ebC8F2d319fD08D9A40",
       "singleSweepGasP50": single, "batches": []}
for r in rows:
    n, g, p = int(r["n"]), int(r["gasUsed"]), int(r["effGasPriceWei"])
    out["batches"].append({"n": n, "gasUsed": g, "gasPerAddress": g // n, "vsSingle": round(g / (n * single), 4),
                           "effGasPriceWei": p, "feeUsdc": round(g * p / 1e18, 9), "feeUsdcPerAddress": round(g * p / 1e18 / n, 9), "tx": r["tx"]})
if len(out["batches"]) >= 2:
    # gas(n) ≈ a + b·n from the two largest batches: b is the marginal cost of one more address, a the fixed tx cost
    (n1, g1), (n2, g2) = [(b["n"], b["gasUsed"]) for b in out["batches"][-2:]]
    b = (g2 - g1) / (n2 - n1); a = g1 - b * n1
    out["fit"] = {"fixedGas": round(a), "marginalGasPerAddress": round(b), "from": f"n={n1} and n={n2}"}
json.dump(out, open("bench/many.json", "w"), indent=2)
print(json.dumps(out, indent=2))
