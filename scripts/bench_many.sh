#!/bin/zsh
# Mainnet gas benchmark for `sweepMany` (README milestone 1): fund N fresh pigeonholes, sweep them all in ONE transaction,
# record the receipt. One row per batch size. Same retry-around-the-multi-backend-RPC shape as bench.sh.
#   KS=/path/to/keystore.json PW=/path/to/password.txt SIZES="1 10 50" zsh scripts/bench_many.sh
RPC=https://rpc.mainnet.arc.io
KS=${KS:?set KS=/path/to/keystore.json}; PW=${PW:?set PW=/path/to/password-file}
F=0x942b8c102e73aeea1a652ebC8F2d319fD08D9A40
SIZES=${SIZES:-"1 10 50"}
PAY=${PAY:-1000000000000}   # 0.000001 USDC per pigeonhole — the balance moved is irrelevant to the gas, the sweep is fixed work
SEND=(--rpc-url $RPC --keystore $KS --password-file $PW)
OUT=bench/many.csv; SALTS=bench/many-salts.csv; mkdir -p bench
echo "n,gasUsed,gasPerAddress,effGasPriceWei,feeUsdc,tx,funded" > $OUT
echo "n,i,id,salt,pigeonhole,payTx" > $SALTS
STAMP=$(date +%s)
retry() { local n=0; local out; while [ $n -lt 12 ]; do if out=$("$@" 2>/dev/null); then print -r -- "$out"; return 0; fi; n=$((n+1)); done; return 1; }
for N in ${=SIZES}; do
  salts=(); funded=0
  for i in $(seq 1 $N); do
    ID="many-$STAMP-$N-$i"; SALT=$(cast keccak "$ID")
    P=$(retry cast call $F "predict(bytes32)(address)" $SALT --rpc-url $RPC) || { echo "  predict failed $N/$i"; continue; }
    tx=$(retry cast send $P --value $PAY "${SEND[@]}" --json | python3 -c "import json,sys;print(json.load(sys.stdin)['transactionHash'])") || { echo "  pay failed $N/$i"; continue; }
    salts+=($SALT); funded=$((funded+1))
    echo "$N,$i,$ID,$SALT,$P,$tx" >> $SALTS
  done
  ARR="[$(IFS=,; echo "${salts[*]}")]"
  tx=$(retry cast send $F "sweepMany(bytes32[])" "$ARR" "${SEND[@]}" --json | python3 -c "import json,sys;print(json.load(sys.stdin)['transactionHash'])") || { echo "  sweepMany($N) failed"; continue; }
  rc=$(retry cast receipt $tx --rpc-url $RPC --json) || { echo "  receipt failed $N"; continue; }
  echo "$rc" | python3 -c "
import json,sys; r=json.load(sys.stdin); g=int(r['gasUsed'],16); p=int(r['effectiveGasPrice'],16); n=$funded
assert r['status']=='0x1', 'reverted'
print(f'{n},{g},{g//n},{p},{g*p/1e18:.9f},$tx,{n}')" >> $OUT
  echo "  sweepMany($funded): $(tail -1 $OUT)"
done
python3 scripts/bench_many_stats.py
