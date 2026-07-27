import React from "react";
import { StyleSheet, Text, View } from "react-native";
import MapView, { Marker } from "react-native-maps";

import { Colors } from "@/constants/theme";
import type { SatelliteMapProps } from "./SatelliteMap.types";

/**
 * Native satellite map backed by react-native-maps (Apple Maps on iOS,
 * Google Maps on Android). The web build uses SatelliteMap.web.tsx instead,
 * which renders a key-free Leaflet + Esri imagery map.
 */
export function SatelliteMap({
  style,
  initialRegion,
  markers,
  onRegionChange,
  interactive = true,
}: SatelliteMapProps) {
  return (
    <MapView
      style={style}
      initialRegion={initialRegion}
      mapType="satellite"
      showsUserLocation
      showsMyLocationButton={false}
      scrollEnabled={interactive}
      zoomEnabled={interactive}
      rotateEnabled={interactive}
      pitchEnabled={interactive}
      onRegionChange={(r) => onRegionChange?.(r)}
    >
      {(markers ?? []).map((m) => (
        <Marker
          key={m.id}
          coordinate={m.coordinate}
          anchor={{ x: 0.5, y: 0.5 }}
          tracksViewChanges={false}
        >
          {m.label ? (
            <View style={styles.numberPin}>
              <Text style={styles.numberPinText}>{m.label}</Text>
            </View>
          ) : (
            <View style={styles.dot} />
          )}
        </Marker>
      ))}
    </MapView>
  );
}

const styles = StyleSheet.create({
  numberPin: {
    minWidth: 26,
    height: 26,
    paddingHorizontal: 6,
    borderRadius: 13,
    backgroundColor: Colors.accent,
    borderWidth: 2,
    borderColor: Colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  numberPinText: { color: Colors.onAccent, fontSize: 13, fontWeight: "800" },
  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: Colors.gold,
    borderWidth: 2,
    borderColor: Colors.surface,
  },
});
