export function formatToDecimals(value) {
  const num = parseFloat(value);
  if (isNaN(num)) return "0.00";
  return num.toFixed(2);
}

export function tktTabs() {
  return [
    "OPEN",
    "PENDING",
    "NEW CONNECTIONS",
    "DISCONNECTIONS",
    "JOB DONE",
  ];
}

export function formatTo12Hour(dateStr) {
  // dateStr like "21-10-2025 18:45:57"
  const [day, month, yearAndTime] = dateStr.split('-');
  const [year, time] = yearAndTime.replace(/ {2,}/g, " ").split(' ');
  const [hours, minutes, seconds] = time.split(':').map(Number);

  const date = new Date(`${year}-${month}-${day}T${time}`);

  const formattedTime = date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });

  return `${day}-${month}-${year} ${formattedTime.toLowerCase()}`;
}