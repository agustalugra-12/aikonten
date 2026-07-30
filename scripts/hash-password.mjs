// Utilitas sekali-pakai: generate ADMIN_PASSWORD_HASH_B64 utk .env
// Pakai: node scripts/hash-password.mjs "password-baru"
//
// Di-base64-kan (BUKAN hash bcrypt mentah) krn ditemukan bug nyata: Next.js/@next-env
// melakukan ekspansi gaya "$VAR" pada value .env - hash bcrypt SELALU mengandung "$"
// (mis. "$2b$10$...") sehingga sebagian hash diam-diam terpotong jadi string acak yang
// salah tiap kali di-load, bikin login SELALU gagal walau password benar. Base64
// menghindari karakter "$" sama sekali jadi tidak kena masalah ini.
import bcrypt from "bcryptjs";

const password = process.argv[2];
if (!password) {
  console.error("Pakai: node scripts/hash-password.mjs <password>");
  process.exit(1);
}

const hash = bcrypt.hashSync(password, 10);
console.log(Buffer.from(hash, "utf-8").toString("base64"));
