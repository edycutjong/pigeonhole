#!/bin/zsh
# Mainnet gas benchmark via cast (settles invariant I4). Retries around the flaky multi-backend RPC.
RPC=https://rpc.mainnet.arc.io
KS=~/.config/arc-microgrants/keystore/3550b005-480d-46dd-bb6d-7a531ff0772b
PW=~/.config/arc-microgrants/keystore.pass
F=0x942b8c102e73aeea1a652ebC8F2d319fD08D9A40
N=${N:-30}; R=${R:-10}
SEND=(--rpc-url $RPC --keystore $KS --password-file $PW)
OUT=bench/rows.csv; mkdir -p bench
echo "kind,id,pigeonhole,gasUsed,effGasPriceWei,tx" > $OUT
STAMP=$(date +%s)
# retry: run "$@" up to 10x, echo stdout on first success, else fail
retry() { local n=0; local out; while [ $n -lt 12 ]; do if out=$("$@" 2>/dev/null); then print -r -- "$out"; return 0; fi; n=$((n+1)); done; return 1; }
sweep_gas() { # $1 salt -> "gasUsed effGasPrice tx"
  local tx; tx=$(retry cast send $F "sweep(bytes32)" $1 "${SEND[@]}" --json | python3 -c "import json,sys;print(json.load(sys.stdin)['transactionHash'])") || return 1
  local rc; rc=$(retry cast receipt $tx --rpc-url $RPC --json) || return 1
  print -r -- "$(echo "$rc" | python3 -c "import json,sys;r=json.load(sys.stdin);print(int(r['gasUsed'],16),int(r['effectiveGasPrice'],16),'$tx')")"
}
ok=0
for i in $(seq 1 $N); do
  ID="bench-$STAMP-$i"; SALT=$(cast keccak "$ID"); P=$(retry cast call $F "predict(bytes32)(address)" $SALT --rpc-url $RPC) || continue
  retry cast send $P --value 1000000000000000 "${SEND[@]}" >/dev/null || continue
  res=$(sweep_gas $SALT) || { echo "  skip $i (rpc)"; continue; }
  echo "moving,$ID,$P,${res% * *},$(echo $res|awk '{print $2}'),$(echo $res|awk '{print $3}')" >> $OUT
  ok=$((ok+1)); [ $((i % 5)) -eq 1 ] && echo "  moving $i/$N gas=$(echo $res|awk '{print $1}')"
done
for i in $(seq 1 $R); do
  SALT=$(cast keccak "bench-empty-$STAMP-$i")
  res=$(sweep_gas $SALT) || continue
  echo "empty,,,$(echo $res|awk '{print $1}'),$(echo $res|awk '{print $2}'),$(echo $res|awk '{print $3}')" >> $OUT
done
echo "collected $ok moving samples"
python3 scripts/bench_stats.py
