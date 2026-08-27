import {
  Search,
  HelpCircle,
  Mail,
  FileText,
  User,
  LogOut,
  ChevronDown,
} from 'lucide-react'

interface UtilityIconProps {
  icon: React.ReactNode
  label: string
  badgeCount?: number
}

function UtilityIcon({ icon, label, badgeCount }: UtilityIconProps) {
  return (
    <div className="flex flex-col items-center gap-1.5 cursor-pointer">
      <div className="relative w-[22px] h-[22px] flex items-center justify-center text-vg-ink">
        {icon}
        {badgeCount != null && badgeCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-vg-red text-white text-[9px] font-bold rounded-full w-[12px] h-[12px] flex items-center justify-center leading-none">
            {badgeCount}
          </span>
        )}
      </div>
      <span className="text-[11px] text-vg-ink leading-none">{label}</span>
    </div>
  )
}

export default function GlobalHeader() {
  return (
    <header className="bg-white shadow-header flex flex-col w-full shrink-0">
      {/* Row 1 — Logo + utility nav (60px) */}
      <div className="flex items-center gap-3 h-[60px] px-6">
        {/* Vanguard logo */}
        <div className="relative w-9 h-9 shrink-0">
          <div className="absolute inset-0 bg-vg-red rounded-[3px]" />
          <span className="absolute font-bold text-[20px] text-white left-[11px] top-[7px] leading-none">
            V
          </span>
        </div>

        <div className="w-px h-6 bg-[#ddd] shrink-0" />

        <span className="text-[13px] text-vg-ink-muted whitespace-nowrap">
          Personal investors
        </span>

        <div className="flex-1" />

        {/* Utility nav icons */}
        <div className="flex items-start gap-[14px]">
          <UtilityIcon icon={<Search size={18} strokeWidth={1.5} />} label="Search" />
          <UtilityIcon icon={<HelpCircle size={18} strokeWidth={1.5} />} label="Support" />
          <UtilityIcon
            icon={<Mail size={18} strokeWidth={1.5} />}
            label="Messages"
            badgeCount={1}
          />
          <UtilityIcon icon={<FileText size={18} strokeWidth={1.5} />} label="Documents" />
          <UtilityIcon icon={<User size={18} strokeWidth={1.5} />} label="Profile" />
          <UtilityIcon icon={<LogOut size={18} strokeWidth={1.5} />} label="Log off" />
        </div>
      </div>

      <div className="h-px bg-vg-divider w-full" />

      {/* Row 2 — L1 nav (40px) */}
      <div className="flex items-center gap-8 h-[40px] px-6 relative">
        {[
          'Advice services',
          'Dashboard',
        ].map((item) => (
          <span key={item} className="text-[14px] text-vg-ink whitespace-nowrap cursor-pointer">
            {item}
          </span>
        ))}

        {/* Portfolio with dropdown indicator */}
        <span className="text-[14px] text-vg-ink whitespace-nowrap cursor-pointer flex items-center gap-0.5">
          Portfolio <ChevronDown size={14} strokeWidth={1.5} className="mt-px" />
        </span>

        {/* Transact — active */}
        <span className="text-[14px] font-bold text-vg-ink whitespace-nowrap cursor-pointer flex items-center gap-0.5 relative">
          Transact <ChevronDown size={14} strokeWidth={1.5} className="mt-px" />
          {/* 3px black active underline */}
          <span className="absolute -bottom-[1px] left-0 right-0 h-[3px] bg-vg-ink rounded-sm" />
        </span>

        {[
          'Products & services',
          'Resources & education',
        ].map((item) => (
          <span key={item} className="text-[14px] text-vg-ink whitespace-nowrap cursor-pointer flex items-center gap-0.5">
            {item} <ChevronDown size={14} strokeWidth={1.5} className="mt-px" />
          </span>
        ))}
      </div>

      <div className="h-px bg-vg-ink/10 w-full" />
    </header>
  )
}
