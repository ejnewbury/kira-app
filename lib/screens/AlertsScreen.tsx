/**
 * AlertsScreen — Color-coded notification feed.
 * Thin left borders by source. No emoji. Text only.
 * Mirror's Edge "Urban Pulse" aesthetic.
 */

import React, { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, RefreshControl } from "react-native";
import { Colors, Typography, Spacing } from "../theme";

interface Notification {
  id: string;
  source: keyof typeof SOURCE_COLORS;
  title: string;
  body?: string;
  severity: "critical" | "warning" | "info";
  created_at: string;
  read: boolean;
}

const SOURCE_COLORS = {
  sentry: Colors.sentry,
  vercel: Colors.vercel,
  supabase: Colors.supabase,
  email: Colors.email,
  qa: Colors.qa,
  system: Colors.system,
} as const;

const BACKEND_URL = "https://kira-backend-six.vercel.app";

export default function AlertsScreen() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [filter, setFilter] = useState<string>("all");
  const [refreshing, setRefreshing] = useState(false);

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/kira/notifications`);
      if (res.ok) {
        const data = await res.json();
        setNotifications(data.notifications || []);
      }
    } catch {
      // Endpoint may not be implemented yet — show empty state
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchNotifications();
    setRefreshing(false);
  }, [fetchNotifications]);

  const filtered =
    filter === "all"
      ? notifications
      : notifications.filter((n) => n.source === filter);

  const sources = Object.keys(SOURCE_COLORS) as (keyof typeof SOURCE_COLORS)[];
  const counts = sources.reduce(
    (acc, s) => ({ ...acc, [s]: notifications.filter((n) => n.source === s).length }),
    {} as Record<string, number>
  );

  const renderNotification = ({ item }: { item: Notification }) => (
    <View style={[styles.card, !item.read && styles.cardUnread]}>
      <View style={[styles.cardBorder, { backgroundColor: SOURCE_COLORS[item.source] || Colors.system }]} />
      <View style={styles.cardContent}>
        <View style={styles.cardHeader}>
          <Text style={styles.sourceLabel}>{item.source.toUpperCase()}</Text>
          <Text style={styles.cardTime}>
            {new Date(item.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
          </Text>
        </View>
        <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
        {item.body ? <Text style={styles.cardBody} numberOfLines={2}>{item.body}</Text> : null}
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>ALERTS</Text>
        {notifications.length > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{notifications.length}</Text>
          </View>
        )}
      </View>

      {/* Filter tabs */}
      <View style={styles.filterRow}>
        <Pressable
          style={[styles.filterTab, filter === "all" && styles.filterTabActive]}
          onPress={() => setFilter("all")}
        >
          <Text style={[styles.filterText, filter === "all" && styles.filterTextActive]}>ALL</Text>
        </Pressable>
        {sources.map((s) => (
          <Pressable
            key={s}
            style={[styles.filterTab, filter === s && styles.filterTabActive]}
            onPress={() => setFilter(filter === s ? "all" : s)}
          >
            <Text style={[styles.filterText, filter === s && styles.filterTextActive]}>
              {s.toUpperCase()}
              {counts[s] ? ` ${counts[s]}` : ""}
            </Text>
          </Pressable>
        ))}
      </View>

      <FlatList
        data={filtered}
        renderItem={renderNotification}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>NO ALERTS</Text>
            <Text style={styles.emptySubtext}>All quiet.</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: Spacing.screenPadding,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.md,
  },
  title: {
    ...Typography.title,
  },
  badge: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 6,
    paddingVertical: 2,
    minWidth: 18,
    alignItems: "center",
  },
  badgeText: {
    color: Colors.white,
    fontSize: 9,
    fontWeight: "600",
    letterSpacing: 1,
  },
  filterRow: {
    flexDirection: "row",
    paddingHorizontal: Spacing.screenPadding,
    marginBottom: Spacing.md,
    gap: Spacing.sm,
    flexWrap: "wrap",
  },
  filterTab: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: "transparent",
  },
  filterTabActive: {
    borderBottomColor: Colors.primary,
  },
  filterText: {
    ...Typography.label,
    fontSize: 8,
  },
  filterTextActive: {
    color: Colors.primary,
  },
  list: {
    paddingHorizontal: Spacing.screenPadding,
    gap: 1,
  },
  card: {
    flexDirection: "row",
    backgroundColor: Colors.white,
  },
  cardUnread: {
    backgroundColor: Colors.surface,
  },
  cardBorder: {
    width: 3,
  },
  cardContent: {
    flex: 1,
    padding: Spacing.md,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  sourceLabel: {
    ...Typography.meta,
    letterSpacing: 3,
  },
  cardTime: {
    ...Typography.meta,
  },
  cardTitle: {
    fontSize: 13,
    fontWeight: "500",
    color: Colors.text,
    marginBottom: 2,
  },
  cardBody: {
    fontSize: 12,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  empty: {
    alignItems: "center",
    paddingTop: 80,
  },
  emptyText: {
    ...Typography.label,
    color: Colors.textFaint,
  },
  emptySubtext: {
    fontSize: 13,
    color: Colors.textFaint,
    marginTop: 4,
  },
});
