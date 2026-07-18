import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { sha512Hex, buildPaymentHash } from "./easebuzz.js";

describe("easebuzz hashing", () => {
  it("sha512Hex matches the canonical SHA-512 of 'abc'", async () => {
    // FIPS 180-4 test vector — proves our Web Crypto path is byte-correct.
    expect(await sha512Hex("abc")).toBe(
      "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a" +
      "2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f"
    );
  });

  it("buildPaymentHash uses the official key|txnid|amount|productinfo|firstname|email|udf1..udf10|salt sequence", async () => {
    const f = {
      key: "P0O87KRJ4R", txnid: "SERV-2002-1-0000007", amount: "400.02",
      productinfo: "fofi", firstname: "Pwa Testing", email: "a@b.c",
      udf1: "1", udf2: "pwaapptest2", udf3: "serviceapp", udf4: "OP49", udf5: "eyJhIjoxfQ==",
      salt: "PM1XH32XM4",
    };
    // Independent reference: udf6..udf10 empty, trailing salt, NO trailing key.
    const seq = [
      f.key, f.txnid, f.amount, f.productinfo, f.firstname, f.email,
      f.udf1, f.udf2, f.udf3, f.udf4, f.udf5, "", "", "", "", "", f.salt,
    ].join("|");
    const expected = createHash("sha512").update(seq, "utf8").digest("hex");
    expect(await buildPaymentHash(f)).toBe(expected);
    // Sanity: exactly 16 separators → 17 fields.
    expect(seq.split("|").length).toBe(17);
  });
});
