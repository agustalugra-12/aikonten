const BUFFER_API_URL = "https://api.buffer.com";

function getBufferToken(): string {
  const token = process.env.BUFFER_ACCESS_TOKEN;
  if (!token) throw new Error("BUFFER_ACCESS_TOKEN belum diisi di .env");
  return token;
}

async function bufferGraphQL<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(BUFFER_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getBufferToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  const data = await res.json();
  if (!res.ok || data.errors) {
    throw new Error(JSON.stringify(data.errors || data));
  }
  return data.data as T;
}

export type BufferChannel = { id: string; name: string; service: string };

// Diverifikasi langsung ke API asli 2026-07-30 (Buffer REST API v1 sudah pensiun,
// deprecated - lihat catatan di buffer.ts) - query & bentuk field ini dicek lewat
// introspeksi GraphQL sungguhan, bukan cuma dokumentasi.
export async function listBufferChannels(): Promise<BufferChannel[]> {
  const orgData = await bufferGraphQL<{ account: { organizations: { id: string }[] } }>(
    "query { account { organizations { id } } }"
  );
  const orgId = orgData.account.organizations[0]?.id;
  if (!orgId) throw new Error("Tidak ada organization Buffer utk akun ini");

  const chData = await bufferGraphQL<{ channels: BufferChannel[] }>(
    "query($input: ChannelsInput!) { channels(input: $input) { id name service } }",
    { input: { organizationId: orgId } }
  );
  return chData.channels;
}
