import { useState, useRef, useEffect } from "react";
import { Sparkles, X, Plus } from "lucide-react";
import type { SkillMetadata } from "src/core/skillsLoader";
import { t } from "src/i18n";

interface SkillSelectorProps {
  skills: SkillMetadata[];
  activeSkillPaths: string[];
  onToggleSkill: (folderPath: string) => void;
  disabled?: boolean;
}

export default function SkillSelector({
  skills,
  activeSkillPaths,
  onToggleSkill,
  disabled,
}: SkillSelectorProps) {
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!showDropdown) return;
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showDropdown]);

  const activeSkills = skills.filter(s => activeSkillPaths.includes(s.folderPath));

  return (
    <div className="llm-hub-skill-selector">
      <Sparkles size={14} className="llm-hub-skill-icon" />
      {activeSkills.map(skill => (
        <span key={skill.folderPath} className="llm-hub-skill-chip">
          {skill.name}
          <button
            className="llm-hub-skill-chip-remove"
            onClick={() => onToggleSkill(skill.folderPath)}
            disabled={disabled}
          >
            <X size={10} />
          </button>
        </span>
      ))}
      <div className="llm-hub-skill-dropdown-wrapper" ref={dropdownRef}>
        <button
          className="llm-hub-skill-add-btn"
          onClick={() => setShowDropdown(!showDropdown)}
          disabled={disabled}
          title={t("skills.add")}
        >
          <Plus size={12} />
        </button>
        {showDropdown && (
          <div className="llm-hub-skill-dropdown">
            {skills.length === 0 ? (
              <div className="llm-hub-skill-dropdown-empty">
                {t("skills.noSkills")}
              </div>
            ) : (
              skills.map(skill => (
                <label key={skill.folderPath} className="llm-hub-skill-dropdown-item">
                  <input
                    type="checkbox"
                    checked={activeSkillPaths.includes(skill.folderPath)}
                    onChange={() => {
                      onToggleSkill(skill.folderPath);
                    }}
                    disabled={disabled}
                  />
                  <div className="llm-hub-skill-dropdown-info">
                    <span className="llm-hub-skill-dropdown-name">{skill.name}</span>
                    {skill.description && (
                      <span className="llm-hub-skill-dropdown-desc">{skill.description}</span>
                    )}
                  </div>
                </label>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
