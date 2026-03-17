import { useState, useEffect } from 'react';
import { DiaryScheduleSettings } from '../types';
import { loadDiaryScheduleSettings, saveDiaryScheduleSettings } from '../lib/diaryData';

const DEFAULT_SCHEDULE: DiaryScheduleSettings = {
  enabled: false,
  timeOfDay: "21:00",
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai",
  lastGeneratedDate: "",
};

export function useDiarySchedule() {
  const [schedule, setSchedule] = useState<DiaryScheduleSettings>(DEFAULT_SCHEDULE);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    loadDiaryScheduleSettings().then((settings) => {
      if (!cancelled) {
        setSchedule(settings);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const updateSchedule = async (next: DiaryScheduleSettings) => {
    setSchedule(next);
    await saveDiaryScheduleSettings(next);
  };

  return {
    schedule,
    updateSchedule,
    loading
  };
}
