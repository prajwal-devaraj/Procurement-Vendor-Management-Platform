#!/bin/bash
set -e
cd /home/claude/procurement
rm -f db/procurement.sqlite

node index.js > /tmp/server.log 2>&1 &
SERVER_PID=$!
sleep 1.5

BASE="http://localhost:4000/api"
fail=0

check() {
  local desc="$1" expected="$2" actual="$3"
  if [ "$actual" == "$expected" ]; then
    echo "PASS: $desc"
  else
    echo "FAIL: $desc (expected $expected, got $actual)"
    fail=1
  fi
}

echo "== Health =="
HEALTH=$(curl -s -o /dev/null -w "%{http_code}" $BASE/health)
check "health check public" "200" "$HEALTH"

echo "== Register users =="
ADMIN=$(curl -s -X POST $BASE/auth/register -H "Content-Type: application/json" -d '{"name":"Admin User","email":"admin@test.com","password":"pass123","role":"SystemAdmin"}')
ADMIN_TOKEN=$(echo $ADMIN | node -e "console.log(JSON.parse(require('fs').readFileSync(0)).token)")

PROC=$(curl -s -X POST $BASE/auth/register -H "Content-Type: application/json" -d '{"name":"Priya Procurement","email":"proc@test.com","password":"pass123","role":"ProcurementAdmin"}')
PROC_TOKEN=$(echo $PROC | node -e "console.log(JSON.parse(require('fs').readFileSync(0)).token)")

EMP=$(curl -s -X POST $BASE/auth/register -H "Content-Type: application/json" -d '{"name":"Eddie Employee","email":"emp@test.com","password":"pass123","role":"Employee","department":"Engineering"}')
EMP_TOKEN=$(echo $EMP | node -e "console.log(JSON.parse(require('fs').readFileSync(0)).token)")

MGR=$(curl -s -X POST $BASE/auth/register -H "Content-Type: application/json" -d '{"name":"Mona Manager","email":"mgr@test.com","password":"pass123","role":"Manager"}')
MGR_TOKEN=$(echo $MGR | node -e "console.log(JSON.parse(require('fs').readFileSync(0)).token)")

FIN=$(curl -s -X POST $BASE/auth/register -H "Content-Type: application/json" -d '{"name":"Fiona Finance","email":"fin@test.com","password":"pass123","role":"Finance"}')
FIN_TOKEN=$(echo $FIN | node -e "console.log(JSON.parse(require('fs').readFileSync(0)).token)")

check "users registered" "0" "$( [ -z "$ADMIN_TOKEN" ] && echo 1 || echo 0 )"

echo "== Create vendor =="
VENDOR=$(curl -s -X POST $BASE/vendors -H "Authorization: Bearer $PROC_TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"Acme Supplies","category":"Office Equipment","contactEmail":"vendor@acme.com","country":"USA"}')
VENDOR_ID=$(echo $VENDOR | node -e "console.log(JSON.parse(require('fs').readFileSync(0)).id)")
echo "Vendor created: $VENDOR_ID"

echo "== Approve vendor =="
VSTATUS=$(curl -s -X PATCH $BASE/vendors/$VENDOR_ID/status -H "Authorization: Bearer $PROC_TOKEN" -H "Content-Type: application/json" -d '{"status":"Active"}')
echo $VSTATUS | node -e "const v=JSON.parse(require('fs').readFileSync(0)); console.log('Vendor status:', v.status)"

echo "== Employee creates purchase request =="
PR=$(curl -s -X POST $BASE/purchaseRequests -H "Authorization: Bearer $EMP_TOKEN" -H "Content-Type: application/json" \
  -d '{"department":"Engineering","justification":"New laptops for the team","items":[{"itemName":"Laptop","quantity":5,"estimatedCost":1200}]}')
PR_ID=$(echo $PR | node -e "console.log(JSON.parse(require('fs').readFileSync(0)).id)")
echo "PR created: $PR_ID"

echo "== Submit PR =="
curl -s -X PATCH $BASE/purchaseRequests/$PR_ID/submit -H "Authorization: Bearer $EMP_TOKEN" > /tmp/pr_submit.json
node -e "const p=JSON.parse(require('fs').readFileSync('/tmp/pr_submit.json')); console.log('Status after submit:', p.status)"

echo "== Manager approves =="
curl -s -X POST $BASE/purchaseRequests/$PR_ID/approve -H "Authorization: Bearer $MGR_TOKEN" -H "Content-Type: application/json" -d '{"comment":"Looks good"}' > /tmp/pr_mgr.json
node -e "const p=JSON.parse(require('fs').readFileSync('/tmp/pr_mgr.json')); console.log('Status after manager approval:', p.status)"

echo "== Finance approves =="
curl -s -X POST $BASE/purchaseRequests/$PR_ID/approve -H "Authorization: Bearer $FIN_TOKEN" -H "Content-Type: application/json" -d '{"comment":"Budget OK"}' > /tmp/pr_fin.json
node -e "const p=JSON.parse(require('fs').readFileSync('/tmp/pr_fin.json')); console.log('Status after finance approval:', p.status)"

echo "== Procurement generates PO =="
PO=$(curl -s -X POST $BASE/purchaseOrders -H "Authorization: Bearer $PROC_TOKEN" -H "Content-Type: application/json" \
  -d "{\"requestId\":\"$PR_ID\",\"vendorId\":\"$VENDOR_ID\"}")
PO_ID=$(echo $PO | node -e "console.log(JSON.parse(require('fs').readFileSync(0)).id)")
echo $PO | node -e "const p=JSON.parse(require('fs').readFileSync(0)); console.log('PO created:', p.poNumber, 'total:', p.totalAmount)"

echo "== Vendor submits invoice =="
INV=$(curl -s -X POST $BASE/invoices -H "Authorization: Bearer $PROC_TOKEN" -H "Content-Type: application/json" \
  -d "{\"poId\":\"$PO_ID\",\"amount\":6000,\"taxAmount\":0}")
INV_ID=$(echo $INV | node -e "console.log(JSON.parse(require('fs').readFileSync(0)).id)")
echo $INV | node -e "const i=JSON.parse(require('fs').readFileSync(0)); console.log('Invoice status:', i.status)"

echo "== Finance approves invoice (creates payment) =="
PAY=$(curl -s -X PATCH $BASE/invoices/$INV_ID/approve -H "Authorization: Bearer $FIN_TOKEN")
echo $PAY | node -e "const p=JSON.parse(require('fs').readFileSync(0)); console.log('Payment created:', p.payment.id, 'status:', p.payment.paymentStatus)"
PAY_ID=$(echo $PAY | node -e "console.log(JSON.parse(require('fs').readFileSync(0)).payment.id)")

echo "== Finance marks payment as paid =="
PAID=$(curl -s -X PATCH $BASE/payments/$PAY_ID/pay -H "Authorization: Bearer $FIN_TOKEN" -H "Content-Type: application/json" -d '{"paymentMethod":"Wire Transfer","transactionReference":"TXN-001"}')
echo $PAID | node -e "const p=JSON.parse(require('fs').readFileSync(0)); console.log('Payment status:', p.paymentStatus)"

echo "== PDF export =="
PDF_CODE=$(curl -s -o /tmp/po.pdf -w "%{http_code}" $BASE/purchaseOrders/$PO_ID/pdf -H "Authorization: Bearer $PROC_TOKEN")
check "PO PDF export" "200" "$PDF_CODE"
file /tmp/po.pdf

echo "== Analytics summary =="
curl -s $BASE/analytics/summary -H "Authorization: Bearer $ADMIN_TOKEN" | node -e "console.log(JSON.stringify(JSON.parse(require('fs').readFileSync(0)), null, 2))"

echo "== Audit logs (admin only) =="
AUDIT_COUNT=$(curl -s $BASE/auditLogs -H "Authorization: Bearer $ADMIN_TOKEN" | node -e "console.log(JSON.parse(require('fs').readFileSync(0)).length)")
echo "Audit log entries: $AUDIT_COUNT"

echo "== RBAC check: employee cannot create vendor =="
RBAC_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST $BASE/vendors -H "Authorization: Bearer $EMP_TOKEN" -H "Content-Type: application/json" -d '{"name":"X","category":"Y","contactEmail":"x@y.com"}')
check "employee blocked from creating vendor" "403" "$RBAC_CODE"

kill $SERVER_PID 2>/dev/null
wait $SERVER_PID 2>/dev/null

echo "================================"
if [ $fail -eq 0 ]; then
  echo "ALL CHECKS PASSED"
else
  echo "SOME CHECKS FAILED"
fi
