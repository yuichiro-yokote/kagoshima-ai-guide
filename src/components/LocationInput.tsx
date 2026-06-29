"use client";

import { useState, useEffect, useRef, useCallback } from "react";

type Suggestion = {
  lat: number;
  lng: number;
  display_name: string;
};

type Props = {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  onSelect: (suggestion: Suggestion) => void;
};

export default function LocationInput({ label, placeholder, value, onChange, onSelect }: Props) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isComposingRef = useRef(false);

  const fetchSuggestions = useCallback(async (query: string) => {
    if (query.trim().length < 1) {
      setSuggestions([]);
      setIsOpen(false);
      return;
    }
    setIsFetching(true);
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(query)}&limit=5`);
      if (!res.ok) { setSuggestions([]); return; }
      const data = await res.json();
      const raw: Suggestion[] = Array.isArray(data) ? data : [data];
      const seen = new Set<string>();
      const list = raw.filter((s) => {
        if (seen.has(s.display_name)) return false;
        seen.add(s.display_name);
        return true;
      });
      setSuggestions(list);
      setIsOpen(list.length > 0);
    } catch {
      setSuggestions([]);
    } finally {
      setIsFetching(false);
    }
  }, []);

  // 通常入力（IME変換中でない）のデバウンス検索
  useEffect(() => {
    if (isComposingRef.current) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(value), 100);
  }, [value, fetchSuggestions]);

  // 外側クリックでドロップダウンを閉じる
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelect = (s: Suggestion) => {
    onChange(s.display_name.split(",")[0].trim());
    onSelect(s);
    setIsOpen(false);
    setSuggestions([]);
  };

  return (
    <div ref={containerRef} className="relative">
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <div className="relative">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onCompositionStart={() => { isComposingRef.current = true; }}
          onCompositionEnd={(e) => {
            isComposingRef.current = false;
            // 変換確定時にuseEffectを待たずに直接検索を起動
            if (debounceRef.current) clearTimeout(debounceRef.current);
            fetchSuggestions((e.target as HTMLInputElement).value);
          }}
          onFocus={() => suggestions.length > 0 && setIsOpen(true)}
          placeholder={placeholder}
          className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        {isFetching && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs">
            検索中...
          </span>
        )}
      </div>

      {isOpen && suggestions.length > 0 && (
        <ul className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
          {suggestions.map((s, i) => (
            <li key={i}>
              <button
                type="button"
                onMouseDown={() => handleSelect(s)}
                className="w-full text-left px-4 py-2 text-sm hover:bg-blue-50 border-b border-gray-100 last:border-0"
              >
                <span className="font-medium text-gray-800">
                  {s.display_name.split(",")[0].trim()}
                </span>
                {s.display_name.includes(",") && (
                  <span className="block text-xs text-gray-400 truncate">
                    {s.display_name.split(",").slice(1).join(",").trim()}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
