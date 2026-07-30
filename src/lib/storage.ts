import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// S3-compatible storage (rekomendasi Cloudflare R2, lihat PRD diskusi) - client upload
// LANGSUNG ke storage via presigned URL, TIDAK proxy lewat server Next.js. Ini penting
// krn footage video mentah bisa besar (ratusan MB-GB) & server yang direncanakan
// (mungkin VPS kecil, lihat PRD diskusi soal kondisi server Pelangi) tidak boleh jadi
// bottleneck utk upload sebesar itu.
function getClient(): S3Client {
  return new S3Client({
    region: process.env.STORAGE_REGION || "auto",
    endpoint: process.env.STORAGE_ENDPOINT,
    credentials: {
      accessKeyId: process.env.STORAGE_ACCESS_KEY_ID || "",
      secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY || "",
    },
  });
}

export async function createPresignedUploadUrl(
  key: string,
  contentType: string
): Promise<{ uploadUrl: string; publicUrl: string }> {
  const bucket = process.env.STORAGE_BUCKET;
  if (!bucket) throw new Error("STORAGE_BUCKET belum diisi di .env");

  const client = getClient();
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
  });
  const uploadUrl = await getSignedUrl(client, command, { expiresIn: 60 * 10 }); // 10 menit

  const base = process.env.STORAGE_PUBLIC_BASE_URL?.replace(/\/$/, "") || "";
  const publicUrl = `${base}/${key}`;

  return { uploadUrl, publicUrl };
}

export function buildAssetKey(brandId: string, projectId: string, filename: string): string {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${brandId}/${projectId}/${Date.now()}-${safe}`;
}
