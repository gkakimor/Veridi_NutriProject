set -u
cd "C:/Users/rdpuser/Documents/VeridiProject/Veridi"
R="$1"
for s in stock production billing traceability; do
  echo "################ RODADA $R · $s · $(date +%H:%M:%S)"
  node "scripts/validate-adversarial-$s.mjs" --reset > "handoff/r$R-$s.log" 2>&1
  echo "exit=$? :: $(grep -E 'verificações ok=' "handoff/r$R-$s.log" | tail -1)"
done
echo "################ FIM RODADA $R $(date +%H:%M:%S)"
