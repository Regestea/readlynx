import { StatisticsCard } from "../../../../components/StatisticsCard/StatisticsCard";
import { Card } from "../../../../components/ui/Card/Card";
import { weekStats } from "../../data/mockData";
import styles from "./WeeklyStats.module.css";

export function WeeklyStats() {
  return (
    <Card variant="glass" className={`animate-fade-up ${styles.widget}`}>
      <StatisticsCard stats={weekStats} />
    </Card>
  );
}
