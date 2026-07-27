import React from "react";
import Svg, { Circle, Path } from "react-native-svg";

import { Colors } from "@/constants/theme";

interface TeeMarkProps {
  /** Rendered height in points. Width scales to keep the mark's aspect ratio. */
  size?: number;
  tint?: string;
  /** Optional lighter highlight on the ball. */
  accent?: string;
}

const RATIO = 100 / 132;

/** A golf ball resting on a tee — the brand motif, drawn as a crisp vector. */
export function TeeMark({ size = 28, tint = Colors.primary, accent }: TeeMarkProps) {
  const width = size * RATIO;
  return (
    <Svg width={width} height={size} viewBox="0 0 100 132" fill="none">
      <Path
        d="M24 64 Q50 76 76 64 L58 118 Q50 126 42 118 Z"
        fill={tint}
      />
      <Circle cx={50} cy={33} r={27} fill={tint} />
      {accent ? <Circle cx={41} cy={24} r={8} fill={accent} opacity={0.9} /> : null}
    </Svg>
  );
}
