import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { WeeklyReportData } from "./weeklyReportData";

// Dokumen PDF laporan mingguan (2026-08-19) - render server-side pakai @react-pdf/renderer
// (React 19 didukung resmi, dicek versi peer dep sebelum install - BUKAN puppeteer/headless
// Chrome: box VPS ini masih 3.8GB & pernah insiden RAM habis krn 1 proses render berat
// [ffmpeg] mematikan seluruh server, jadi library yang render tanpa browser terpisah lebih
// aman dari kelas insiden yang sama). Isi PERSIS sama dgn WeeklyReport.tsx (in-app) supaya
// tidak ada 2 sumber kebenaran laporan yang bisa beda angka - keduanya konsumsi
// WeeklyReportData yang sama dari weeklyReportData.ts.
const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 11, fontFamily: "Helvetica" },
  header: { marginBottom: 16 },
  brandName: { fontSize: 18, fontWeight: 700, marginBottom: 2 },
  subtitle: { fontSize: 10, color: "#666" },
  sectionTitle: { fontSize: 13, fontWeight: 700, marginTop: 18, marginBottom: 8 },
  totalRow: { fontSize: 24, fontWeight: 700, marginBottom: 8 },
  pillarRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  pillarBadge: {
    fontSize: 9,
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 4,
    border: "1 solid #ccc",
    marginRight: 6,
    marginBottom: 6,
  },
  contentItem: {
    flexDirection: "row",
    borderBottom: "1 solid #eee",
    paddingVertical: 8,
    gap: 10,
  },
  rank: { fontSize: 14, fontWeight: 700, color: "#888", width: 20 },
  contentBody: { flex: 1 },
  contentMeta: { fontSize: 9, color: "#666", marginBottom: 2 },
  contentCaption: { fontSize: 10, color: "#333" },
  contentStats: { width: 90, textAlign: "right" },
  contentViews: { fontSize: 12, fontWeight: 700 },
  contentEngagement: { fontSize: 9, color: "#666" },
  emptyNote: { fontSize: 10, color: "#888", fontStyle: "italic" },
  footer: { position: "absolute", bottom: 24, left: 32, right: 32, fontSize: 8, color: "#999", textAlign: "center" },
});

export function WeeklyReportPdf({ brandName, data }: { brandName: string; data: WeeklyReportData }) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.brandName}>{brandName}</Text>
          <Text style={styles.subtitle}>
            Laporan {data.windowDays} Hari Terakhir - dibuat {new Date().toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}
          </Text>
        </View>

        <Text style={styles.sectionTitle}>Ringkasan Aktivitas</Text>
        <Text style={styles.totalRow}>{data.totalPublished} konten tayang</Text>
        {data.byPillar.length === 0 ? (
          <Text style={styles.emptyNote}>Belum ada konten tayang di jendela waktu ini.</Text>
        ) : (
          <View style={styles.pillarRow}>
            {data.byPillar.map((p) => (
              <Text key={p.pillar} style={styles.pillarBadge}>
                {p.pillar}: {p.count}
              </Text>
            ))}
          </View>
        )}

        <Text style={styles.sectionTitle}>5 Konten Terbaik (berdasar views)</Text>
        {!data.topContentDataAvailable ? (
          <Text style={styles.emptyNote}>
            Belum ada data performa (views) untuk konten di jendela waktu ini.
          </Text>
        ) : (
          data.topContent.map((c, i) => (
            <View key={c.id} style={styles.contentItem}>
              <Text style={styles.rank}>{i + 1}</Text>
              <View style={styles.contentBody}>
                <Text style={styles.contentMeta}>
                  {[c.pillar, c.angle].filter(Boolean).join(" · ") || "(tanpa pilar)"}
                </Text>
                {c.captionSnippet ? <Text style={styles.contentCaption}>{c.captionSnippet}</Text> : null}
              </View>
              <View style={styles.contentStats}>
                <Text style={styles.contentViews}>{(c.views ?? 0).toLocaleString("id-ID")} views</Text>
                {c.engagementRate !== null ? (
                  <Text style={styles.contentEngagement}>{c.engagementRate.toFixed(2)}% engagement</Text>
                ) : null}
              </View>
            </View>
          ))
        )}

        <Text style={styles.footer}>Dibuat otomatis oleh KontenPilot AI</Text>
      </Page>
    </Document>
  );
}
