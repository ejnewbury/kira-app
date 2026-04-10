import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const BG = "#0D0D0D";
const SURFACE = "#1A1A1A";
const CARD = "#242424";
const ACCENT = "#E08A4A";
const TEXT_PRIMARY = "#F5F5F5";
const TEXT_SECONDARY = "#999";
const KIRA_TEAL = "#2A9D8F";

interface Notification {
  id: string;
  source: "sentry" | "vercel" | "supabase" | "email" | "qa" | "system";
  title: string;
  body: string;
  severity: "critical" | "warning" | "info";
  timestamp: string;
  read: boolean;
}

const SOURCE_CONFIG: Record<string, { label: string; icon: string; color: string }> = {
  sentry: { label: "Sentry", icon: "🐛", color: "#E03E2F" },
  vercel: { label: "Vercel", icon: "▲", color: "#FFFFFF" },
  supabase: { label: "Supabase", icon: "⚡", color: "#3ECF8E" },
  email: { label: "Email", icon: "✉️", color: "#4DA8DA" },
  qa: { label: "QA", icon: "🧪", color: "#FFB74D" },
  system: { label: "System", icon: "⚙️", color: TEXT_SECONDARY },
};

const SEVERITY_COLORS = {
  critical: "#FF4444",
  warning: "#FFB74D",
  info: TEXT_SECONDARY,
};

interface Props {
  onClose: () => void;
}

export default function NotificationsScreen({ onClose }: Props) {
  const insets = useSafeAreaInsets();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<string | null>(null);

  const fetchNotifications = useCallback(async () => {
    try {
      // TODO: Fetch from backend API /api/kira/notifications
      // For now, show placeholder data from recent monitor events
      const res = await fetch("https://kira-backend-six.vercel.app/api/kira/notifications").catch(() => null);
      if (res?.ok) {
        const data = await res.json();
        setNotifications(data.notifications || []);
      }
    } catch {
      // Backend endpoint not yet implemented — show empty state
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchNotifications();
  };

  const filtered = filter
    ? notifications.filter((n) => n.source === filter)
    : notifications;

  const sourceCounts = notifications.reduce((acc, n) => {
    acc[n.source] = (acc[n.source] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const renderNotification = ({ item }: { item: Notification }) => {
    const config = SOURCE_CONFIG[item.source] || SOURCE_CONFIG.system;
    return (
      <View style={[styles.notifCard, !item.read && styles.notifUnread]}>
        <View style={styles.notifHeader}>
          <View style={styles.notifSource}>
            <Text style={styles.notifIcon}>{config.icon}</Text>
            <Text style={[styles.notifSourceLabel, { color: config.color }]}>
              {config.label}
            </Text>
          </View>
          <View style={styles.notifMeta}>
            <View style={[styles.severityDot, { backgroundColor: SEVERITY_COLORS[item.severity] }]} />
            <Text style={styles.notifTime}>
              {new Date(item.timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
            </Text>
          </View>
        </View>
        <Text style={styles.notifTitle}>{item.title}</Text>
        <Text style={styles.notifBody} numberOfLines={3}>{item.body}</Text>
      </View>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={onClose} hitSlop={12}>
          <Text style={styles.backButton}>← Back</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Notifications</Text>
        <View style={{ width: 60 }} />
      </View>

      {/* Filter tabs */}
      <View style={styles.filterRow}>
        <Pressable
          style={[styles.filterTab, !filter && styles.filterTabActive]}
          onPress={() => setFilter(null)}
        >
          <Text style={[styles.filterText, !filter && styles.filterTextActive]}>
            All ({notifications.length})
          </Text>
        </Pressable>
        {Object.entries(SOURCE_CONFIG).map(([key, config]) => {
          const count = sourceCounts[key] || 0;
          if (count === 0) return null;
          return (
            <Pressable
              key={key}
              style={[styles.filterTab, filter === key && styles.filterTabActive]}
              onPress={() => setFilter(filter === key ? null : key)}
            >
              <Text style={[styles.filterText, filter === key && styles.filterTextActive]}>
                {config.icon} {count}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Notification list */}
      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={ACCENT} />
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.centerContainer}>
          <Text style={styles.emptyIcon}>🔔</Text>
          <Text style={styles.emptyTitle}>No notifications</Text>
          <Text style={styles.emptySubtitle}>
            {notifications.length === 0
              ? "Notifications from Sentry, Vercel, email, and QA will appear here."
              : "No notifications in this category."}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          renderItem={renderNotification}
          keyExtractor={(item) => item.id}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={ACCENT} />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: CARD,
  },
  backButton: {
    color: KIRA_TEAL,
    fontSize: 16,
  },
  headerTitle: {
    color: TEXT_PRIMARY,
    fontSize: 18,
    fontWeight: "700",
  },
  filterRow: {
    flexDirection: "row",
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 6,
    flexWrap: "wrap",
  },
  filterTab: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: CARD,
  },
  filterTabActive: {
    backgroundColor: KIRA_TEAL,
  },
  filterText: {
    color: TEXT_SECONDARY,
    fontSize: 12,
  },
  filterTextActive: {
    color: TEXT_PRIMARY,
    fontWeight: "600",
  },
  list: {
    flex: 1,
  },
  listContent: {
    padding: 12,
    gap: 8,
  },
  notifCard: {
    backgroundColor: SURFACE,
    borderRadius: 12,
    padding: 14,
    borderLeftWidth: 3,
    borderLeftColor: "transparent",
  },
  notifUnread: {
    borderLeftColor: ACCENT,
  },
  notifHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  notifSource: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  notifIcon: {
    fontSize: 14,
  },
  notifSourceLabel: {
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
  },
  notifMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  severityDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  notifTime: {
    fontSize: 11,
    color: TEXT_SECONDARY,
  },
  notifTitle: {
    color: TEXT_PRIMARY,
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 4,
  },
  notifBody: {
    color: TEXT_SECONDARY,
    fontSize: 13,
    lineHeight: 18,
  },
  centerContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyTitle: {
    color: TEXT_PRIMARY,
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 8,
  },
  emptySubtitle: {
    color: TEXT_SECONDARY,
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
});
