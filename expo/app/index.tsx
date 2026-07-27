import { ActivityIndicator, StyleSheet, View } from "react-native";

import { Wordmark } from "@/components/Wordmark";
import { Colors } from "@/constants/theme";

/** Brief entry screen — the auth gate redirects to the right place immediately. */
export default function Index() {
  return (
    <View style={styles.container}>
      <Wordmark size={34} layout="vertical" accent={Colors.accent} />
      <ActivityIndicator color={Colors.accent} style={styles.spinner} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    alignItems: "center",
    justifyContent: "center",
  },
  spinner: { marginTop: 28 },
});
