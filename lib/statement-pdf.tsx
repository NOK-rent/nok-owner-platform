'use client'

/**
 * PDF del statement mensual del propietario — branding NOK.
 * Se renderiza client-side con @react-pdf/renderer desde el tab Cálculos.
 */

import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'
import type { MonthlyStatement } from '@/lib/monthly-statement'

const EARTH = '#833B0E'
const SELVA = '#0E6845'
const BLACK = '#1A1A1A'
const TIMELESS = '#F0EFED'
const BOLDNESS = '#F20022'

const styles = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 10,
    paddingTop: 40,
    paddingBottom: 56,
    paddingHorizontal: 44,
    backgroundColor: '#FFFFFF',
    color: BLACK,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
    paddingBottom: 14,
    borderBottom: `2px solid ${BLACK}`,
  },
  brandName: { fontSize: 24, fontFamily: 'Helvetica-Bold', letterSpacing: 5, color: BLACK },
  brandTagline: { fontSize: 8, color: '#8A8A8A', marginTop: 3, letterSpacing: 1 },
  headerRight: { alignItems: 'flex-end' },
  docTitle: { fontSize: 13, fontFamily: 'Helvetica-Bold', color: BLACK },
  docSub: { fontSize: 9, color: '#8A8A8A', marginTop: 2 },

  infoBlock: {
    flexDirection: 'row',
    gap: 14,
    marginTop: 14,
    marginBottom: 18,
    backgroundColor: TIMELESS,
    padding: 12,
    borderRadius: 6,
  },
  infoColumn: { flex: 1 },
  infoLabel: { fontSize: 7, color: '#8A8A8A', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 2 },
  infoValue: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: BLACK },

  sectionTitle: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    color: EARTH,
    marginBottom: 6,
    marginTop: 12,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderBottom: '1px solid #EEECE8',
  },
  rowLabel: { fontSize: 10, color: BLACK },
  rowSub: { fontSize: 8, color: '#9A9A9A', marginTop: 1 },
  rowAmount: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: BLACK },
  deduction: { color: BOLDNESS },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingHorizontal: 8,
    marginTop: 2,
    backgroundColor: TIMELESS,
    borderRadius: 4,
  },
  totalLabel: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: BLACK },
  totalAmount: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: SELVA },

  finalBlock: {
    marginTop: 18,
    padding: 16,
    borderRadius: 8,
    backgroundColor: BLACK,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  finalLabel: { fontSize: 9, color: '#CFCCC6', textTransform: 'uppercase', letterSpacing: 1 },
  finalAmount: { fontSize: 20, fontFamily: 'Helvetica-Bold', color: '#FFFFFF' },

  note: { fontSize: 7.5, color: '#9A9A9A', marginTop: 14, lineHeight: 1.5 },
  footer: {
    position: 'absolute',
    bottom: 24,
    left: 44,
    right: 44,
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTop: '1px solid #E5E3DF',
    paddingTop: 8,
  },
  footerText: { fontSize: 7.5, color: '#9A9A9A' },
})

function usd(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
}

export function StatementPDF({ s, ownerName, monthLabel }: { s: MonthlyStatement; ownerName: string; monthLabel: string }) {
  return (
    <Document title={`NOK — Estado de cuenta ${s.propertyName} ${monthLabel}`} author="NOK">
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.brandName}>NOK</Text>
            <Text style={styles.brandTagline}>Feels right. Anywhere.</Text>
          </View>
          <View style={styles.headerRight}>
            <Text style={styles.docTitle}>Estado de cuenta del propietario</Text>
            <Text style={styles.docSub}>{monthLabel}</Text>
          </View>
        </View>

        {/* Info */}
        <View style={styles.infoBlock}>
          <View style={styles.infoColumn}>
            <Text style={styles.infoLabel}>Propietario</Text>
            <Text style={styles.infoValue}>{ownerName}</Text>
          </View>
          <View style={styles.infoColumn}>
            <Text style={styles.infoLabel}>Propiedad</Text>
            <Text style={styles.infoValue}>{s.propertyName}</Text>
          </View>
          <View style={styles.infoColumn}>
            <Text style={styles.infoLabel}>Ocupación</Text>
            <Text style={styles.infoValue}>{s.occupancyPct}% · {s.nights} noches</Text>
          </View>
          <View style={styles.infoColumn}>
            <Text style={styles.infoLabel}>Tarifa promedio</Text>
            <Text style={styles.infoValue}>{usd(s.adr)}</Text>
          </View>
        </View>

        {/* NOK report */}
        <Text style={styles.sectionTitle}>Reporte NOK</Text>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Ingresos brutos del mes</Text>
          <Text style={styles.rowAmount}>{usd(s.gross)}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Comisión NOK ({Math.round(s.commissionRate * 100)}%)</Text>
          <Text style={[styles.rowAmount, styles.deduction]}>−{usd(s.nokCommission)}</Text>
        </View>
        {s.cleaning > 0 && (
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Limpiezas ({s.checkouts} check-outs)</Text>
            <Text style={[styles.rowAmount, styles.deduction]}>−{usd(s.cleaning)}</Text>
          </View>
        )}
        {s.directCommission > 0 && (
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Comisión reserva directa (10%)</Text>
            <Text style={[styles.rowAmount, styles.deduction]}>−{usd(s.directCommission)}</Text>
          </View>
        )}
        {s.utilities > 0 && (
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Servicios públicos</Text>
            <Text style={[styles.rowAmount, styles.deduction]}>−{usd(s.utilities)}</Text>
          </View>
        )}
        {s.maintenance > 0 && (
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Mantenimiento</Text>
            <Text style={[styles.rowAmount, styles.deduction]}>−{usd(s.maintenance)}</Text>
          </View>
        )}
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Ingreso neto propietario (NOK)</Text>
          <Text style={styles.totalAmount}>{usd(s.nokNet)}</Text>
        </View>

        {/* Owner expenses */}
        <Text style={styles.sectionTitle}>Tus gastos adicionales</Text>
        {s.ownerExpenses.length === 0 ? (
          <View style={styles.row}>
            <Text style={[styles.rowLabel, { color: '#9A9A9A' }]}>Sin gastos registrados este mes</Text>
            <Text style={styles.rowAmount}>{usd(0)}</Text>
          </View>
        ) : (
          s.ownerExpenses.map(e => (
            <View style={styles.row} key={e.id}>
              <View>
                <Text style={styles.rowLabel}>{e.label}</Text>
                {e.currency !== 'USD' && (
                  <Text style={styles.rowSub}>
                    {e.amountOriginal.toLocaleString('en-US')} {e.currency}
                  </Text>
                )}
              </View>
              <Text style={[styles.rowAmount, styles.deduction]}>−{usd(e.amountUSD)}</Text>
            </View>
          ))
        )}
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Total gastos propios</Text>
          <Text style={[styles.totalAmount, { color: BOLDNESS }]}>−{usd(s.ownerExpensesTotal)}</Text>
        </View>

        {/* Final */}
        <View style={styles.finalBlock}>
          <Text style={styles.finalLabel}>Resultado final del mes</Text>
          <Text style={[styles.finalAmount, s.finalNet < 0 ? { color: '#FF6B81' } : {}]}>{usd(s.finalNet)}</Text>
        </View>

        <Text style={styles.note}>
          {s.currencyNote} El reporte NOK refleja los movimientos gestionados por NOK. Los gastos adicionales
          son registrados por el propietario en su portal y no afectan la liquidación de NOK. Documento generado
          desde owners.nok.rent.
        </Text>

        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>NOK · owners.nok.rent · owners@nok.rent</Text>
          <Text style={styles.footerText} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  )
}
