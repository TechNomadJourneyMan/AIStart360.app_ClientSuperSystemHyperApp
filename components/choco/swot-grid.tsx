"use client";

import { motion } from "framer-motion";
import { CheckCircle, XCircle, PlusCircle, AlertTriangle } from "lucide-react";

interface SWOTGridProps {
  data: {
    strengths: string[];
    weaknesses: string[];
    opportunities: string[];
    threats: string[];
  };
}

export function SWOTGrid({ data }: SWOTGridProps) {
  const sections = [
    { 
      title: "Strengths", 
      items: data.strengths, 
      icon: <CheckCircle className="text-green-400" size={20} />, 
      color: "border-green-500/20 bg-green-500/5",
      textColor: "text-green-400"
    },
    { 
      title: "Weaknesses", 
      items: data.weaknesses, 
      icon: <XCircle className="text-[#E50000]" size={20} />, 
      color: "border-red-500/20 bg-red-500/5",
      textColor: "text-red-400"
    },
    { 
      title: "Opportunities", 
      items: data.opportunities, 
      icon: <PlusCircle className="text-blue-400" size={20} />, 
      color: "border-blue-500/20 bg-blue-500/5",
      textColor: "text-blue-400"
    },
    { 
      title: "Threats", 
      items: data.threats, 
      icon: <AlertTriangle className="text-yellow-400" size={20} />, 
      color: "border-yellow-500/20 bg-yellow-500/5",
      textColor: "text-yellow-400"
    }
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {sections.map((section, idx) => (
        <motion.div
          key={idx}
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ delay: idx * 0.1 }}
          viewport={{ once: true }}
          className={`p-8 rounded-3xl border ${section.color} backdrop-blur-sm shadow-xl flex flex-col h-full group hover:bg-white/[0.02] transition-all`}
        >
          <div className="flex items-center gap-4 mb-6">
            <div className={`p-3 rounded-2xl bg-white/5 border border-white/10 group-hover:scale-110 transition-transform`}>
              {section.icon}
            </div>
            <h4 className={`text-xl font-bold tracking-tight ${section.textColor}`}>{section.title}</h4>
          </div>
          <ul className="space-y-4 flex-1">
            {section.items.map((item, i) => (
              <li key={i} className="flex items-start gap-3 group/item">
                <span className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 group-hover/item:scale-150 transition-transform ${
                  section.title === 'Strengths' ? 'bg-green-500' :
                  section.title === 'Weaknesses' ? 'bg-[#E50000]' :
                  section.title === 'Opportunities' ? 'bg-blue-500' :
                  'bg-yellow-500'
                }`} />
                <span className="text-gray-400 leading-relaxed group-hover/item:text-gray-200 transition-colors">{item}</span>
              </li>
            ))}
          </ul>
        </motion.div>
      ))}
    </div>
  );
}
