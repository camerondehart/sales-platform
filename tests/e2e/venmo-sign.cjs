// Builds Venmo-style "paid you" emails signed with a TEST DKIM key, for the
// Venmo inbox tests. The matching public key goes in keys.json, which the app
// reads through DKIM_TEST_KEYS_FILE (honoured only off Vercel).
//
//   node venmo-sign.cjs <outDir> <appDir> <id> '<json options>'
// options: payer, amount, note, txn, to, from, signDomain, subject, tamper
//          [from, to], extraSubject, unsigned, bodyLength, html (HTML-only body), fwd
const fs = require("fs"), path = require("path"), crypto = require("crypto");

function keyPair(outDir) {
  const pemFile = path.join(outDir, "key.pem");
  fs.mkdirSync(outDir, { recursive: true });
  if (!fs.existsSync(pemFile)) {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    fs.writeFileSync(pemFile, privateKey.export({ type: "pkcs8", format: "pem" }));
    const p = publicKey.export({ type: "spki", format: "der" }).toString("base64");
    // Venmo's real selector names are unknown here; any works for the test.
    const rec = `v=DKIM1; k=rsa; p=${p}`;
    fs.writeFileSync(path.join(outDir, "keys.json"), JSON.stringify({ "s1._domainkey.venmo.com": rec, "s1._domainkey.attacker.test": rec }));
  }
  return fs.readFileSync(pemFile, "utf8");
}

async function build(outDir, appDir, id, o) {
  const { dkimSign } = require(path.join(appDir, "node_modules/mailauth"));
  const amount = Number(o.amount ?? 64).toFixed(2);
  const payer = o.payer || "Shannon Garrett";
  const subject = o.subject || `${o.fwd ? "Fwd: " : ""}${payer} paid you $${amount}`;
  const note = o.note ?? "Consultation for Shannon Garrett";
  const txn = o.txn === undefined ? String(4000000000000000000n + BigInt(Math.floor(Math.random() * 1e12))) : o.txn;
  const text = [`${payer} paid you`, `$${amount}`, note, txn ? `Transaction ID ${txn}` : "", "Date Oct 27, 2026", "See transaction https://venmo.com/story/abc123XYZ9"].filter((l) => l !== "").join("\r\n");
  const html = `<html><body><table><tr><td><p>${payer} paid you</p></td></tr><tr><td>$${amount}</td></tr><tr><td><p>${note}</p></td></tr>${txn ? `<tr><td>Transaction ID</td><td>${txn}</td></tr>` : ""}</table></body></html>`;
  const headers = [
    `From: ${o.from || "Venmo <venmo@venmo.com>"}`,
    `To: ${o.to || "nicole@example.com"}`,
    `Subject: ${subject}`,
    `Date: Tue, 27 Oct 2026 18:04:00 +0000`,
    `Message-ID: <${id}@venmo.com>`,
    `MIME-Version: 1.0`,
  ];
  let body;
  if (o.html) {
    headers.push(`Content-Type: text/html; charset=utf-8`, `Content-Transfer-Encoding: base64`);
    body = Buffer.from(html).toString("base64").replace(/(.{76})/g, "$1\r\n");
  } else {
    headers.push(`Content-Type: multipart/alternative; boundary="b1"`);
    body = [`--b1`, `Content-Type: text/plain; charset=utf-8`, `Content-Transfer-Encoding: quoted-printable`, ``, text.replace(/=/g, "=3D"), `--b1`, `Content-Type: text/html; charset=utf-8`, ``, html, `--b1--`, ``].join("\r\n");
  }
  let msg = headers.join("\r\n") + "\r\n\r\n" + body;
  if (!o.unsigned) {
    const sig = await dkimSign(msg, {
      canonicalization: "relaxed/relaxed",
      signatureData: [{ signingDomain: o.signDomain || "venmo.com", selector: "s1", privateKey: keyPair(outDir), headerList: ["from", "to", "subject", "date", "message-id"], ...(o.bodyLength ? { maxBodyLength: o.bodyLength } : {}) }],
    });
    if (sig.errors?.length) throw new Error(JSON.stringify(sig.errors));
    msg = sig.signatures + msg;
  }
  // What Gmail's auto-forward adds on top (not signed, not changed).
  msg = `Delivered-To: venmo-inbox@example.resend.app\r\nX-Forwarded-To: venmo-inbox@example.resend.app\r\nX-Forwarded-For: nicole@example.com venmo-inbox@example.resend.app\r\n` + msg;
  if (o.extraSubject) msg = `Subject: ${o.extraSubject}\r\n` + msg;
  if (o.tamper) msg = msg.split(o.tamper[0]).join(o.tamper[1]);
  keyPair(outDir);
  const file = path.join(outDir, `${id}.eml`);
  fs.writeFileSync(file, msg);
  return { file, txn };
}

module.exports = { build };

if (require.main === module) {
  const [outDir, appDir, id, json] = process.argv.slice(2);
  build(outDir, appDir, id, JSON.parse(json || "{}"))
    .then((r) => console.log(JSON.stringify(r)))
    .catch((e) => { console.error(e); process.exit(1); });
}
