# The order process of the quick start (quick-start.md), and the pictures of the animated demo on
# the landing page (theme/LandingDemo.vue): waiting at its user task before `operate advance` and
# ended after it.
# Run `npm run shots` in docs/; it draws them with bpmn-cli into public/shots/.
set -e
out="$(pwd)/public/shots"
work=$(mktemp -d)
cd "$work"
bpmn new order.bpmn --name "Order"
bpmn add order.bpmn start "Order received"
bpmn add order.bpmn userTask "Review order" --after Event_OrderReceived
bpmn add order.bpmn end "Done" --after Activity_ReviewOrder
bpmn render order.bpmn -o "$out/quick-start-order.svg"
bpmn render order.bpmn -o "$out/landing-demo-before.svg" --highlight Activity_ReviewOrder
bpmn render order.bpmn -o "$out/landing-demo-after.svg" --highlight Event_Done
rm -rf "$work"
