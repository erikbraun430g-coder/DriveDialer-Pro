
import React from 'react';

const Trips: React.FC = () => {
  const trips = [
    { id: '1', date: 'Oct 24, 2023', from: 'Home', to: 'Office', km: 12.5, time: '22m', eff: '14.2 kWh/100km' },
    { id: '2', date: 'Oct 23, 2023', from: 'Office', to: 'Supermarket', km: 4.8, time: '12m', eff: '16.5 kWh/100km' },
    { id: '3', date: 'Oct 23, 2023', from: 'Supermarket', to: 'Home', km: 8.2, time: '18m', eff: '13.8 kWh/100km' },
    { id: '4', date: 'Oct 22, 2023', from: 'Home', to: 'Hiking Trail', km: 45.0, time: '55m', eff: '15.1 kWh/100km' },
  ];

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-bold">Trip History</h2>
          <p className="text-slate-400">Review your recent drives and efficiency metrics.</p>
        </div>
        <button className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl font-medium shadow-lg transition-all flex items-center gap-2">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" /></svg>
          Export CSV
        </button>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-800/50 border-b border-slate-700">
                <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Date</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Route</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Distance</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Duration</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Efficiency</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {trips.map((trip) => (
                <tr key={trip.id} className="hover:bg-slate-800/30 transition-colors">
                  <td className="px-6 py-4 text-sm whitespace-nowrap">{trip.date}</td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-medium">{trip.from}</span>
                      <svg className="w-3 h-3 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
                      <span className="font-medium">{trip.to}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm font-semibold">{trip.km} km</td>
                  <td className="px-6 py-4 text-sm text-slate-400">{trip.time}</td>
                  <td className="px-6 py-4">
                    <span className="bg-green-900/20 text-green-400 text-xs font-bold px-2 py-1 rounded border border-green-800/30">
                      {trip.eff}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default Trips;
