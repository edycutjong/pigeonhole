import csv, json, statistics as st
rows=list(csv.DictReader(open('bench/rows.csv')))
def summ(xs):
    xs=sorted(xs); n=len(xs)
    p=lambda q: xs[min(n-1,int(q/100*n))]
    return {"n":n,"min":xs[0],"p50":p(50),"p95":p(95),"max":xs[-1],"mean":round(st.mean(xs))}
moving=[int(r['gasUsed']) for r in rows if r['kind']=='moving']
empty=[int(r['gasUsed']) for r in rows if r['kind']=='empty']
gp=[int(r['effGasPriceWei']) for r in rows if r['gasUsed']]
res={"network":"arc-mainnet","chainId":5042,"factory":"0x942b8c102e73aeea1a652ebC8F2d319fD08D9A40",
 "movingSweepGas":summ(moving),"emptySweepGas":summ(empty) if empty else None,
 "effGasPriceWei":summ(gp),"preStated_I4":64140,
 "feeUsdc_at_p50":round(summ(moving)["p50"]*summ(gp)["p50"]/1e18,9),
 "note":"I4 pre-stated from probe n=1 (64,140). This is the N-sample mainnet distribution via cast."}
json.dump(res,open('bench/results.json','w'),indent=2)
print(json.dumps(res,indent=2))
