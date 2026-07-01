

export function fitnessSeries(profile, startDate) {
  const hist = profile.fitnessHistory || [];
  const series = key => {
    const dates = [startDate].concat(hist.map(h => h.date));
    const vals = hist.map(h => h[key]).concat([profile[key]]);
    const pts = [];
    for (let i = 0; i < vals.length; i++) if (vals[i] != null) pts.push({ date: dates[i], value: vals[i] });
    return pts;
  };
  return { run: series('fivekSec'), swim: series('css100Sec'), bike: series('ftp') };
}
