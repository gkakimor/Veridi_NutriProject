set -u
cd "C:/Users/rdpuser/Documents/VeridiProject/Veridi"
for R in 1 2; do
  for s in stock production billing traceability; do
    echo "######## RODADA $R · $s · $(date +%H:%M:%S)"
    node "scripts/validate-adversarial-$s.mjs" --reset > "handoff/r$R-$s.log" 2>&1
    echo "   exit=$? :: $(grep -E 'verificações ok=' "handoff/r$R-$s.log" | tail -1)"
  done
done
echo "######## PORTAO CONCLUIDO $(date +%H:%M:%S)"
