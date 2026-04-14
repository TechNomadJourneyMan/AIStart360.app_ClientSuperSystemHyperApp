"use client";

import { motion } from "framer-motion";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell } from "recharts";

interface MarketShareData {
  company: string;
  gmv: number;
  share: number;
  growth: number;
  color: string;
}

interface MarketShareChartProps {
  data: MarketShareData[];
}

export function MarketShareChart({ data }: { data: any[] }) {
  // Add customized tooltip for formatting values
  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const dataItem = payload[0].payload;
      return (
        <div className="bg-[#1f2937]/95 backdrop-blur-md border border-[#374151] rounded-xl p-4 shadow-2xl">
          <p className="font-bold text-white mb-2 text-lg">{dataItem.name}</p>
          <div className="space-y-1.5">
            <div className="flex justify-between items-center gap-6 text-sm">
              <span className="text-gray-400">Market Share:</span>
              <span className="text-white font-bold">{dataItem.share}%</span>
            </div>
            <div className="flex justify-between items-center gap-6 text-sm">
              <span className="text-gray-400">Dynamics:</span>
              <span className={`font-bold ${dataItem.growth.startsWith('+') ? 'text-green-400' : 'text-[#E50000]'}`}>
                {dataItem.growth}
              </span>
            </div>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.6 }}
      className="p-8 rounded-3xl border border-white/10 bg-[#111111]/80 backdrop-blur-xl h-[450px] flex flex-col shadow-2xl relative overflow-hidden group"
    >
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-[#E50000] via-transparent to-transparent opacity-30 group-hover:opacity-100 transition-opacity" />
      
      <h3 className="text-xl font-bold text-white mb-8 flex items-center">
        <span className="w-1.5 h-6 bg-[#E50000] rounded-full mr-4"></span>
        Market Share Evolution (2024E)
      </h3>
      
      <div className="flex-1 w-full h-full pb-6">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 0, right: 30, left: 10, bottom: 0 }}>
            <XAxis type="number" hide domain={[0, 40]} />
            <YAxis 
              dataKey="name" 
              type="category" 
              axisLine={false} 
              tickLine={false} 
              tick={{ fill: '#6b7280', fontSize: 12, fontWeight: 600 }} 
              width={100}
            />
            <Tooltip cursor={{ fill: 'rgba(255,255,255,0.03)' }} content={<CustomTooltip />} />
            <Bar dataKey="share" radius={[0, 12, 12, 0]} barSize={32}>
              {data.map((entry, index) => (
                <Cell 
                  key={`cell-${index}`} 
                  fill={entry.highlight ? '#E50000' : '#2a2a2a'} 
                  className="hover:opacity-80 transition-opacity cursor-pointer"
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      
      <div className="mt-4 flex items-center gap-4 text-[10px] text-gray-500 uppercase tracking-widest font-semibold border-t border-white/5 pt-4">
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-[#E50000]" />
          <span>Core Growth Target</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-[#2a2a2a]" />
          <span>Market Comparables</span>
        </div>
      </div>
    </motion.div>
  );
}
