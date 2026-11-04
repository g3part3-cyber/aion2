import { generateKeyPairSync } from "node:crypto";

const { publicKey, privateKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "der" },
});

console.log(JSON.stringify({
    publicKey: publicKey.subarray(-65).toString("base64url"),
    privateKey: privateKey.subarray(-32).toString("base64url"),
}, null, 2));
