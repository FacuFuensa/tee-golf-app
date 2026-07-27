import type { StyleProp, ViewStyle } from "react-native";

export interface MapRegion {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}

export interface MapMarkerData {
  /** Stable identity for the marker. */
  id: string;
  coordinate: { latitude: number; longitude: number };
  /** When set, renders a numbered pin; otherwise a small saved-green dot. */
  label?: string;
}

export interface SatelliteMapProps {
  style?: StyleProp<ViewStyle>;
  initialRegion: MapRegion;
  markers?: MapMarkerData[];
  onRegionChange?: (region: MapRegion) => void;
  /** When false, the map renders as a static preview (no pan/zoom). Defaults to true. */
  interactive?: boolean;
}
