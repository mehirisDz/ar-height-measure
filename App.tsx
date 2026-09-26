import React from 'react';
import { Button, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useHeightMeasurement } from './src/hooks/useHeightMeasurement';

/**
 * This is a developer test harness, not the app's UI. Its only job is to
 * let you watch the measurement engine's state and readings live on a
 * physical device (see docs/VALIDATION.md for a tape-measure test
 * protocol). Replace this file once real UI work starts — nothing else in
 * the project depends on it.
 */
export default function App() {
  const engine = useHeightMeasurement();

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.heading}>AR Height Measure — dev harness</Text>

        <Row label="Engine state" value={engine.state} />
        {engine.reason ? <Row label="Reason" value={engine.reason} /> : null}
        <Row
          label="Capabilities"
          value={
            engine.capabilities
              ? `LiDAR: ${engine.capabilities.lidar ? 'yes' : 'no'}  ·  Plane classification: ${
                  engine.capabilities.planeClassification ? 'yes' : 'no'
                }`
              : 'unknown (start the session first)'
          }
        />

        <View style={styles.divider} />

        {engine.reading ? (
          <>
            <Text style={styles.bigNumber}>{engine.reading.heightCm.toFixed(1)} cm</Text>
            <Row label="Quality" value={engine.reading.quality} />
            <Row label="Stable right now" value={engine.reading.isStable ? 'yes' : 'no'} />
            <Row label="Uncertainty (±mm)" value={(engine.reading.uncertaintyMeters * 1000).toFixed(1)} />
            <Row label="Raw camera Y (m)" value={engine.reading.rawCameraY.toFixed(4)} />
            <Row label="Filtered camera Y (m)" value={engine.reading.filteredCameraY.toFixed(4)} />
            <Row label="Locked floor Y (m)" value={engine.reading.floorY.toFixed(4)} />
          </>
        ) : (
          <Text style={styles.dim}>No reading yet — start the session, then point the phone at the floor.</Text>
        )}

        <View style={styles.divider} />

        <View style={styles.buttonRow}>
          <Button title="Start" onPress={() => engine.start()} />
          <Button title="Recalibrate" onPress={() => engine.recalibrate()} />
          <Button title="Stop" onPress={() => engine.stop()} />
        </View>

        <Text style={styles.dim}>
          Flow: Start → point the phone at the floor and hold still until state becomes "measuring" →
          raise the phone above your head → read the number. See docs/VALIDATION.md to compare against
          a tape measure.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#111' },
  container: { padding: 20, gap: 8 },
  heading: { color: '#fff', fontSize: 18, fontWeight: '600', marginBottom: 12 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  rowLabel: { color: '#aaa', fontSize: 14 },
  rowValue: { color: '#fff', fontSize: 14, fontWeight: '500' },
  bigNumber: { color: '#fff', fontSize: 48, fontWeight: '700', textAlign: 'center', marginVertical: 12 },
  dim: { color: '#888', fontSize: 12, marginTop: 12 },
  divider: { height: 1, backgroundColor: '#333', marginVertical: 12 },
  buttonRow: { flexDirection: 'row', justifyContent: 'space-around', marginVertical: 12 },
});
