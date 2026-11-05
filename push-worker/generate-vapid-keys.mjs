import { generateKeyPairSync } from "node:crypto";

const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const jwk = privateKey.export({ format: "jwk" });
const publicKey = Buffer.concat([
    Buffer.from([0x04]),
    Buffer.from(jwk.x, "base64url"),
    Buffer.from(jwk.y, "base64url"),
]);

console.log(JSON.stringify({
    publicKey: publicKey.toString("base64url"),
    privateKey: jwk.d,
}, null, 2));
