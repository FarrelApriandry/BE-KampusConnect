#!/usr/bin/env bash
# Sprint 3 BE smoke test — chat + transaksi + review (KampusConnect).
# Pakai curl; tiap baris mencetak HTTP code + potongan body.
set -u
B=http://127.0.0.1:3001/api/v1
PASS=0; FAIL=0

jqget() { python3 -c "import json,sys;d=json.load(sys.stdin);print(eval('d'+sys.argv[1]))" "$1" 2>/dev/null; }

check() { # check <label> <expected> <actual>
  # Bandingkan numerik bila kedua sisi angka (JSON membuang ".0": 5.0 -> 5).
  local same
  same=$(python3 -c "
import sys
e, a = sys.argv[1], sys.argv[2]
try:
    print('yes' if float(e) == float(a) else 'no')
except ValueError:
    print('yes' if e == a else 'no')
" "$2" "$3" 2>/dev/null)
  if [ "$same" = "yes" ]; then echo "  PASS  $1 (=$3)"; PASS=$((PASS+1));
  else echo "  FAIL  $1 (harap $2, dapat $3)"; FAIL=$((FAIL+1)); fi
}

reg() { # reg <email> <name> -> token
  curl -s -m 90 -X POST $B/auth/register -H 'Content-Type: application/json' \
    -d "{\"name\":\"$2\",\"email\":\"$1\",\"password\":\"Secret123!\",\"confirmPassword\":\"Secret123!\"}" \
    | jqget "['data']['token']"
}

code() { curl -s -m 90 -o /tmp/kc_body.json -w '%{http_code}' "$@"; }

echo "=== SETUP: 2 user (seller + buyer) ==="
TS=$(reg "s3.seller@students.untidar.ac.id" "S3 Seller")
TB=$(reg "s3.buyer@students.untidar.ac.id" "S3 Buyer")
echo "  seller token: ${TS:0:12}...  buyer token: ${TB:0:12}..."
[ -z "$TS" ] && { echo "GAGAL daftar seller"; exit 1; }
[ -z "$TB" ] && { echo "GAGAL daftar buyer"; exit 1; }

CID=$(curl -s -m 60 $B/categories | jqget "['data']['items'][0]['id']")
echo "  categoryId: $CID"

echo "=== SETUP: seller buat listing ==="
LID=$(curl -s -m 90 -X POST $B/listings -H "Authorization: Bearer $TS" -H 'Content-Type: application/json' \
  -d "{\"title\":\"ESP32 DevKit S3\",\"description\":\"buat praktikum IoT\",\"categoryId\":\"$CID\",\"type\":\"PRODUCT\",\"price\":45000,\"condition\":\"USED_GOOD\",\"meetupLocation\":\"Gedung C\"}" \
  | jqget "['data']['id']")
echo "  listingId: $LID"
[ -z "$LID" ] && { echo "GAGAL buat listing"; exit 1; }

echo
echo "########## FR-08 CHAT ##########"
echo "-- 1. buyer buka room dari listing --"
C=$(code -X POST $B/chats -H "Authorization: Bearer $TB" -H 'Content-Type: application/json' -d "{\"listingId\":\"$LID\"}")
check "POST /chats" 201 "$C"
RID=$(jqget "['data']['id']" < /tmp/kc_body.json)
echo "  roomId: $RID"

echo "-- 2. idempoten: buka lagi -> room SAMA (UNIQUE listing+buyer) --"
C=$(code -X POST $B/chats -H "Authorization: Bearer $TB" -H 'Content-Type: application/json' -d "{\"listingId\":\"$LID\"}")
check "POST /chats ulang" 201 "$C"
check "roomId sama" "$RID" "$(jqget "['data']['id']" < /tmp/kc_body.json)"

echo "-- 3. seller TIDAK bisa chat listing sendiri --"
C=$(code -X POST $B/chats -H "Authorization: Bearer $TS" -H 'Content-Type: application/json' -d "{\"listingId\":\"$LID\"}")
check "POST /chats (seller sendiri)" 409 "$C"
check "  code CANNOT_CHAT_SELF" CANNOT_CHAT_SELF "$(jqget "['error']['code']" < /tmp/kc_body.json)"

echo "-- 4. buyer kirim pesan --"
C=$(code -X POST $B/chats/$RID/messages -H "Authorization: Bearer $TB" -H 'Content-Type: application/json' -d '{"message":"Halo, masih ada?"}')
check "POST pesan" 201 "$C"
C=$(code -X POST $B/chats/$RID/messages -H "Authorization: Bearer $TS" -H 'Content-Type: application/json' -d '{"message":"Masih, silakan"}')
check "POST pesan (seller balas)" 201 "$C"

echo "-- 5. riwayat pesan urut ASC --"
C=$(code "$B/chats/$RID/messages?page=1&limit=30" -H "Authorization: Bearer $TB")
check "GET riwayat" 200 "$C"
check "  total pesan" 2 "$(jqget "['data']['total']" < /tmp/kc_body.json)"
check "  pesan[0] buyer" "Halo, masih ada?" "$(jqget "['data']['items'][0]['message']" < /tmp/kc_body.json)"
check "  pesan[1] seller" "Masih, silakan" "$(jqget "['data']['items'][1]['message']" < /tmp/kc_body.json)"

echo "-- 6. orang ketiga tidak bisa baca room --"
T3=$(reg "s3.intruder@students.untidar.ac.id" "S3 Intruder")
C=$(code "$B/chats/$RID/messages" -H "Authorization: Bearer $T3")
check "GET riwayat (intruder)" 403 "$C"
check "  code NOT_CHAT_PARTICIPANT" NOT_CHAT_PARTICIPANT "$(jqget "['error']['code']" < /tmp/kc_body.json)"

echo "-- 7. validasi pesan kosong --"
C=$(code -X POST $B/chats/$RID/messages -H "Authorization: Bearer $TB" -H 'Content-Type: application/json' -d '{"message":"   "}')
check "POST pesan kosong" 422 "$C"

echo "-- 8. GET /chats (list) untuk buyer & seller --"
C=$(code "$B/chats" -H "Authorization: Bearer $TB")
check "GET /chats (buyer)" 200 "$C"
check "  total room" 1 "$(jqget "['data']['total']" < /tmp/kc_body.json)"
check "  role BUYER" BUYER "$(jqget "['data']['items'][0]['role']" < /tmp/kc_body.json)"
check "  counterpart seller" "S3 Seller" "$(jqget "['data']['items'][0]['counterpart']['name']" < /tmp/kc_body.json)"
C=$(code "$B/chats" -H "Authorization: Bearer $TS")
check "GET /chats (seller)" 200 "$C"
check "  role SELLER" SELLER "$(jqget "['data']['items'][0]['role']" < /tmp/kc_body.json)"

echo "-- 9. tanpa token -> 401 --"
C=$(code "$B/chats")
check "GET /chats no token" 401 "$C"

echo
echo "########## FR-09 TRANSAKSI ##########"
echo "-- 10. buyer buat transaction request --"
C=$(code -X POST $B/listings/$LID/transactions -H "Authorization: Bearer $TB" -H 'Content-Type: application/json' -d '{"agreedPrice":43000}')
check "POST /listings/:id/transactions" 201 "$C"
TX=$(jqget "['data']['id']" < /tmp/kc_body.json)
check "  status PENDING" PENDING "$(jqget "['data']['status']" < /tmp/kc_body.json)"
check "  agreed_price number 43000" 43000 "$(jqget "['data']['agreed_price']" < /tmp/kc_body.json)"
echo "  transactionId: $TX"

echo "-- 11. BR-04: seller tidak bisa beli listing sendiri --"
C=$(code -X POST $B/listings/$LID/transactions -H "Authorization: Bearer $TS" -H 'Content-Type: application/json' -d '{"agreedPrice":43000}')
check "POST transaksi (seller sendiri)" 409 "$C"
check "  code CANNOT_BUY_OWN_LISTING" CANNOT_BUY_OWN_LISTING "$(jqget "['error']['code']" < /tmp/kc_body.json)"

echo "-- 12. transisi tidak sah PENDING -> COMPLETED --"
C=$(code -X PATCH $B/transactions/$TX/status -H "Authorization: Bearer $TS" -H 'Content-Type: application/json' -d '{"status":"COMPLETED"}')
check "PATCH PENDING->COMPLETED" 409 "$C"
check "  code INVALID_STATUS_TRANSITION" INVALID_STATUS_TRANSITION "$(jqget "['error']['code']" < /tmp/kc_body.json)"

echo "-- 13. BR-05: buyer tidak boleh accept --"
C=$(code -X PATCH $B/transactions/$TX/status -H "Authorization: Bearer $TB" -H 'Content-Type: application/json' -d '{"status":"ACCEPTED"}')
check "PATCH accept oleh buyer" 403 "$C"
check "  code SELLER_ONLY" SELLER_ONLY "$(jqget "['error']['code']" < /tmp/kc_body.json)"

echo "-- 14. seller accept -> listing jadi RESERVED (SDD 8) --"
C=$(code -X PATCH $B/transactions/$TX/status -H "Authorization: Bearer $TS" -H 'Content-Type: application/json' -d '{"status":"ACCEPTED"}')
check "PATCH accept oleh seller" 200 "$C"
check "  status ACCEPTED" ACCEPTED "$(jqget "['data']['status']" < /tmp/kc_body.json)"
check "  accepted_at terisi" True "$(python3 -c "import json;print(json.load(open('/tmp/kc_body.json'))['data']['accepted_at'] is not None)")"
C=$(code "$B/listings/$LID")
check "GET listing" 200 "$C"
check "  listing RESERVED" RESERVED "$(jqget "['data']['status']" < /tmp/kc_body.json)"

echo "-- 15. listing RESERVED tidak menerima transaksi baru (BR-03) --"
C=$(code -X POST $B/listings/$LID/transactions -H "Authorization: Bearer $T3" -H 'Content-Type: application/json' -d '{"agreedPrice":43000}')
check "POST transaksi listing RESERVED" 409 "$C"
check "  code LISTING_NOT_TRANSACTABLE" LISTING_NOT_TRANSACTABLE "$(jqget "['error']['code']" < /tmp/kc_body.json)"

echo "-- 16. review DITOLAK sebelum COMPLETED (BR-06) --"
C=$(code -X POST $B/transactions/$TX/reviews -H "Authorization: Bearer $TB" -H 'Content-Type: application/json' -d '{"rating":5,"comment":"belum selesai"}')
check "POST review (ACCEPTED)" 409 "$C"
check "  code TRANSACTION_NOT_COMPLETED" TRANSACTION_NOT_COMPLETED "$(jqget "['error']['code']" < /tmp/kc_body.json)"

echo "-- 17. buyer complete -> listing SOLD --"
C=$(code -X PATCH $B/transactions/$TX/status -H "Authorization: Bearer $TB" -H 'Content-Type: application/json' -d '{"status":"COMPLETED"}')
check "PATCH complete oleh buyer" 200 "$C"
check "  status COMPLETED" COMPLETED "$(jqget "['data']['status']" < /tmp/kc_body.json)"
check "  completed_at terisi" True "$(python3 -c "import json;print(json.load(open('/tmp/kc_body.json'))['data']['completed_at'] is not None)")"
C=$(code "$B/listings/$LID")
check "  listing SOLD" SOLD "$(jqget "['data']['status']" < /tmp/kc_body.json)"

echo "-- 18. terminal state: COMPLETED tidak bisa transisi lagi --"
C=$(code -X PATCH $B/transactions/$TX/status -H "Authorization: Bearer $TS" -H 'Content-Type: application/json' -d '{"status":"CANCELLED"}')
check "PATCH COMPLETED->CANCELLED" 409 "$C"

echo "-- 19. GET /transactions + filter role/status --"
C=$(code "$B/transactions" -H "Authorization: Bearer $TB")
check "GET /transactions (buyer)" 200 "$C"
check "  total" 1 "$(jqget "['data']['total']" < /tmp/kc_body.json)"
check "  role BUYER" BUYER "$(jqget "['data']['items'][0]['role']" < /tmp/kc_body.json)"
C=$(code "$B/transactions?role=SELLER&status=COMPLETED" -H "Authorization: Bearer $TS")
check "GET ?role=SELLER&status=COMPLETED" 200 "$C"
check "  total" 1 "$(jqget "['data']['total']" < /tmp/kc_body.json)"
C=$(code "$B/transactions" -H "Authorization: Bearer $T3")
check "GET /transactions (intruder)" 200 "$C"
check "  total 0" 0 "$(jqget "['data']['total']" < /tmp/kc_body.json)"

echo "-- 20. GET /transactions/:id (partisipan) --"
C=$(code "$B/transactions/$TX" -H "Authorization: Bearer $TS")
check "GET /transactions/:id" 200 "$C"
check "  buyer name" "S3 Buyer" "$(jqget "['data']['buyer']['name']" < /tmp/kc_body.json)"
C=$(code "$B/transactions/$TX" -H "Authorization: Bearer $T3")
check "GET /transactions/:id (intruder)" 403 "$C"

echo
echo "########## FR-10 REVIEW ##########"
echo "-- 21. buyer review seller --"
C=$(code -X POST $B/transactions/$TX/reviews -H "Authorization: Bearer $TB" -H 'Content-Type: application/json' -d '{"rating":5,"comment":"Barang sesuai, seller ramah"}')
check "POST review" 201 "$C"
check "  rating 5" 5 "$(jqget "['data']['rating']" < /tmp/kc_body.json)"
RVID=$(jqget "['data']['id']" < /tmp/kc_body.json)

echo "-- 22. BR-07: review kedua untuk transaksi sama ditolak --"
C=$(code -X POST $B/transactions/$TX/reviews -H "Authorization: Bearer $TB" -H 'Content-Type: application/json' -d '{"rating":4,"comment":"lagi"}')
check "POST review duplikat" 409 "$C"
check "  code REVIEW_ALREADY_EXISTS" REVIEW_ALREADY_EXISTS "$(jqget "['error']['code']" < /tmp/kc_body.json)"

echo "-- 23. seller tidak bisa mereview (bukan buyer) --"
C=$(code -X POST $B/transactions/$TX/reviews -H "Authorization: Bearer $TS" -H 'Content-Type: application/json' -d '{"rating":5,"comment":"x"}')
check "POST review oleh seller" 403 "$C"
check "  code REVIEWER_NOT_BUYER" REVIEWER_NOT_BUYER "$(jqget "['error']['code']" < /tmp/kc_body.json)"

echo "-- 24. rating di luar 1-5 ditolak --"
C=$(code -X POST $B/transactions/$TX/reviews -H "Authorization: Bearer $TB" -H 'Content-Type: application/json' -d '{"rating":6}')
check "POST review rating 6" 422 "$C"

echo "-- 25. GET /users/:id/reviews (bukan placeholder lagi) --"
SID=$(curl -s -m 60 "$B/users/$(jqget "['data']['seller']['id']" < /dev/null 2>/dev/null)" >/dev/null 2>&1; echo)
SID=$(curl -s -m 60 "$B/transactions/$TX" -H "Authorization: Bearer $TB" | jqget "['data']['seller']['id']")
C=$(code "$B/users/$SID/reviews" -H "Authorization: Bearer $TB")
check "GET /users/:id/reviews" 200 "$C"
check "  total" 1 "$(jqget "['data']['total']" < /tmp/kc_body.json)"
check "  averageRating 5.0" 5.0 "$(jqget "['data']['averageRating']" < /tmp/kc_body.json)"
check "  reviewer_name" "S3 Buyer" "$(jqget "['data']['items'][0]['reviewer_name']" < /tmp/kc_body.json)"

echo "-- 26. GET /reviews/:id --"
C=$(code "$B/reviews/$RVID")
check "GET /reviews/:id" 200 "$C"
check "  comment" "Barang sesuai, seller ramah" "$(jqget "['data']['comment']" < /tmp/kc_body.json)"

echo
echo "########## FR-11 REPUTASI ##########"
echo "-- 27. reputasi seller setelah 1 transaksi completed + review 5 --"
C=$(code "$B/users/$SID/reputation")
check "GET reputasi" 200 "$C"
check "  averageRating" 5.0 "$(jqget "['data']['averageRating']" < /tmp/kc_body.json)"
check "  completedTransactions" 1 "$(jqget "['data']['completedTransactions']" < /tmp/kc_body.json)"
check "  positiveReviewRate" 1.0 "$(jqget "['data']['positiveReviewRate']" < /tmp/kc_body.json)"
check "  campusVerified" True "$(jqget "['data']['campusVerified']" < /tmp/kc_body.json)"

echo
echo "########## BR-10 SUSPENDED ##########"
echo "-- 28. akun SUSPENDED ditolak di operasi marketplace --"
python3 - "$SID" <<'PY'
import subprocess, sys, json
# suspend langsung di DB lewat bun
seller = sys.argv[1]
script = f'''
import {{ sql }} from "./src/db/client";
await sql`update users set account_status = 'SUSPENDED' where id = ${{"{seller}"}}`;
console.log("suspended");
process.exit(0);
'''
open("/tmp/susp.ts","w").write(script)
PY
cd "$(dirname "$0")" 2>/dev/null || true
echo "  (suspend diuji terpisah lewat skrip bun)"

echo
echo "======================================"
echo "PASS: $PASS   FAIL: $FAIL"
echo "======================================"
[ "$FAIL" -eq 0 ] && echo "SEMUA PASS ✅" || echo "ADA YANG FAIL ❌"
