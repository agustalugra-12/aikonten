import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { MonthlyReportData } from "./monthlyReportData";
import type { StrategicRecommendation } from "@/lib/ai/monthlyStrategicRecommendation";

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 10, fontFamily: "Helvetica" },
  header: { marginBottom: 14 },
  brandName: { fontSize: 18, fontWeight: 700, marginBottom: 2 },
  subtitle: { fontSize: 10, color: "#666" },
  sectionTitle: { fontSize: 13, fontWeight: 700, marginTop: 14, marginBottom: 6 },
  statsRow: { flexDirection: "row", gap: 20, marginBottom: 6 },
  statBox: { flex: 1 },
  statValue: { fontSize: 18, fontWeight: 700 },
  statLabel: { fontSize: 8, color: "#666" },
  breakdownRow: { flexDirection: "row", justifyContent: "space-between", borderBottom: "1 solid #eee", paddingVertical: 3 },
  recoCategory: { fontSize: 10, fontWeight: 700, marginTop: 8, marginBottom: 3 },
  recoItem: { fontSize: 9, color: "#333", marginBottom: 2 },
  emptyNote: { fontSize: 9, color: "#888", fontStyle: "italic" },
  footer: { position: "absolute", bottom: 24, left: 32, right: 32, fontSize: 8, color: "#999", textAlign: "center" },
});

const RECO_LABEL: Record<keyof StrategicRecommendation, string> = {
  continue: "CONTINUE - Teruskan",
  increase: "INCREASE - Tambah Porsi",
  test: "TEST - Coba Kombinasi Baru",
  reduce: "REDUCE - Kurangi",
  stop: "STOP - Hentikan",
};

function Breakdown({ title, items }: { title: string; items: { label: string; avgViews: number; count: number }[] }) {
  return (
    <View style={{ marginBottom: 10 }}>
      <Text style={{ fontSize: 10, fontWeight: 700, marginBottom: 3 }}>{title}</Text>
      {items.length === 0 ? (
        <Text style={styles.emptyNote}>Belum ada data.</Text>
      ) : (
        items.map((b) => (
          <View key={b.label} style={styles.breakdownRow}>
            <Text>{b.label}</Text>
            <Text>{b.avgViews.toLocaleString("id-ID")} views rata-rata ({b.count} konten)</Text>
          </View>
        ))
      )}
    </View>
  );
}

export function MonthlyReportPdf({
  brandName,
  data,
  recommendation,
}: {
  brandName: string;
  data: MonthlyReportData;
  recommendation: StrategicRecommendation;
}) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.brandName}>{brandName}</Text>
          <Text style={styles.subtitle}>
            Laporan Bulanan ({data.windowDays} hari terakhir) - dibuat {new Date().toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}
          </Text>
        </View>

        <Text style={styles.sectionTitle}>Ringkasan Eksekutif</Text>
        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{data.totalContent}</Text>
            <Text style={styles.statLabel}>Total Konten Tayang</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{data.totalViews.toLocaleString("id-ID")}</Text>
            <Text style={styles.statLabel}>Total Views</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{data.avgEngagementRate !== null ? data.avgEngagementRate.toFixed(2) + "%" : "-"}</Text>
            <Text style={styles.statLabel}>Rata-rata Engagement</Text>
          </View>
        </View>
        {data.bestContent && (
          <Text style={{ fontSize: 9, marginBottom: 2 }}>
            Konten terbaik: {data.bestContent.captionSnippet} ({data.bestContent.views.toLocaleString("id-ID")} views)
          </Text>
        )}
        {data.worstContent && (
          <Text style={{ fontSize: 9 }}>
            Konten terlemah: {data.worstContent.captionSnippet} ({data.worstContent.views.toLocaleString("id-ID")} views)
          </Text>
        )}

        <Text style={styles.sectionTitle}>Analisis Performa</Text>
        <Breakdown title="Per Tipe Konten" items={data.byContentType} />
        <Breakdown title="Per Pilar" items={data.byPillar} />
        <Breakdown title="Per Tipe Hook" items={data.byHookType} />
        <Breakdown title="Per Struktur Video" items={data.byStructure} />

        <Text style={styles.sectionTitle}>Rekomendasi Strategis</Text>
        {(Object.keys(RECO_LABEL) as (keyof StrategicRecommendation)[]).map((key) => (
          <View key={key}>
            <Text style={styles.recoCategory}>{RECO_LABEL[key]}</Text>
            {recommendation[key].length === 0 ? (
              <Text style={styles.emptyNote}>Tidak ada.</Text>
            ) : (
              recommendation[key].map((item, i) => (
                <Text key={i} style={styles.recoItem}>- {item}</Text>
              ))
            )}
          </View>
        ))}

        <Text style={styles.footer}>Dibuat otomatis oleh KontenPilot AI</Text>
      </Page>
    </Document>
  );
}
