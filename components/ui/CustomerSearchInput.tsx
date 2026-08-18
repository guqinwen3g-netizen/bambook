/**
 * 智能客户搜索输入框
 * 支持输入联想、键盘导航、回车确认
 */

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, X, Building2, User, Check, MapPin } from 'lucide-react';
import { Relation } from '../../types';
import { BAMBOOK_OS } from './bambookOsTokens';

interface CustomerOption {
  value: string;
  label: string;
  description?: string;
  billingAddress?: string;
  shippingAddress?: string;
  relation: Relation;
}

interface CustomerSearchInputProps {
  relations: Relation[];
  value: string;
  onChange: (value: string, option?: CustomerOption) => void;
  placeholder?: string;
  isDarkMode?: boolean;
}

export default function CustomerSearchInput({
  relations,
  value,
  onChange,
  placeholder = '输入客户名称搜索...',
  isDarkMode = true
}: CustomerSearchInputProps) {
  const [inputValue, setInputValue] = useState(value || '');
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // 过滤出组织类型的客户（排除联系人）
  const customers = useMemo(() => {
    return relations
      .filter(r => r.isOrganization && !r.deletedAt)
      .map(r => ({
        value: r.id,
        label: r.name,
        description: r.officialAddress || r.billingAddress || '',
        billingAddress: r.billingAddress || r.officialAddress || '',
        shippingAddress: r.shippingAddress || r.officialAddress || '',
        relation: r
      }));
  }, [relations]);

  // 搜索过滤
  const filteredCustomers = useMemo(() => {
    if (!inputValue.trim()) return customers.slice(0, 10);
    const term = inputValue.toLowerCase();
    return customers.filter(c =>
      c.label.toLowerCase().includes(term) ||
      c.description?.toLowerCase().includes(term)
    ).slice(0, 10);
  }, [customers, inputValue]);

  // 选中的客户
  const selectedCustomer = useMemo(() => {
    return customers.find(c => c.value === value);
  }, [customers, value]);

  // 点击外部关闭
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 键盘导航
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        setIsOpen(true);
        e.preventDefault();
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex(i => Math.min(i + 1, filteredCustomers.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex(i => Math.max(i - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (filteredCustomers[highlightedIndex]) {
          selectCustomer(filteredCustomers[highlightedIndex]);
        }
        break;
      case 'Escape':
        setIsOpen(false);
        break;
    }
  };

  const selectCustomer = (customer: CustomerOption) => {
    setInputValue(customer.label);
    onChange(customer.value, customer);
    setIsOpen(false);
  };

  const clearSelection = () => {
    setInputValue('');
    onChange('', undefined);
    inputRef.current?.focus();
  };
  const fieldClass = BAMBOOK_OS.controls.recessedField.base;
  const menu = BAMBOOK_OS.controls.overlayMenu;
  const menuSurfaceClass = `${menu.surfaceBase} ${menu.surface}`;
  const optionIdleClass = `${menu.itemBase} h-auto min-h-14 py-3 flex items-start gap-3 ${menu.item}`;
  const optionSelectedClass = menu.itemSelected;
  const iconShellClass = BAMBOOK_OS.controls.actionControl.base;
  const compactActionClass = BAMBOOK_OS.controls.actionControl.base;

  return (
    <div ref={containerRef} className="relative">
      {/* 输入框 */}
      <div className={`relative group ${isOpen ? 'z-50' : ''}`}>
        <Search
          className="absolute left-3 top-1/2 -translate-y-1/2 transition-colors text-[var(--text-tertiary)] group-focus-within:text-[var(--text-tertiary)]"
          size={14}
        />
        <input
          ref={inputRef}
          type="text"
          value={selectedCustomer ? selectedCustomer.label : inputValue}
          onChange={(e) => {
            setInputValue(e.target.value);
            setIsOpen(true);
            setHighlightedIndex(0);
            if (selectedCustomer) {
              onChange('', undefined);
            }
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className={`w-full pl-9 pr-10 py-2.5 rounded-control border transition-all outline-none ${fieldClass}`}
        />
        {selectedCustomer && (
          <button
            onClick={clearSelection}
            className={`absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-full transition-colors ${compactActionClass}`}
          >
            <X size={14} className="text-[var(--text-tertiary)]" />
          </button>
        )}
      </div>

      {/* 下拉建议列表 */}
      <AnimatePresence>
        {isOpen && filteredCustomers.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
            className={`absolute top-full left-0 right-0 mt-2 overflow-hidden ${menuSurfaceClass}`}
          >
            <div className="max-h-72 overflow-y-auto py-1">
              {filteredCustomers.map((customer, idx) => (
                <button
                  key={customer.value}
                  onClick={() => selectCustomer(customer)}
                  onMouseEnter={() => setHighlightedIndex(idx)}
                  className={`${optionIdleClass} ${idx === highlightedIndex ? optionSelectedClass : ''}`}
                >
                  <div className={`p-1.5 rounded-control mt-0.5 ${iconShellClass}`}>
                    <Building2 size={14} className="text-[var(--text-tertiary)]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className={`font-light text-sm truncate text-[var(--text-primary)]`}>
                      {customer.label}
                    </div>
                    {customer.description && (
                      <div className={`text-xs mt-0.5 truncate text-[var(--text-tertiary)]`}>
                        <MapPin size={14} className="inline mr-1" />
                        {customer.description}
                      </div>
                    )}
                    {/* 显示 Bill To / Ship To */}
                    {(customer.billingAddress || customer.shippingAddress) && (
                      <div className="flex gap-3 mt-1">
                        {customer.billingAddress && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-bds-sm bg-[var(--recessed-bg)] text-[var(--text-secondary)]`}>
                            Bill To
                          </span>
                        )}
                        {customer.shippingAddress && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-bds-sm bg-[var(--recessed-bg)] text-[var(--text-secondary)]`}>
                            Ship To
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  {idx === highlightedIndex && (
                    <Check size={14} className="text-[var(--os-vnext-brand-blue)] mt-1" />
                  )}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 无结果提示 */}
      <AnimatePresence>
        {isOpen && inputValue.trim() && filteredCustomers.length === 0 && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="absolute top-full left-0 right-0 mt-2 px-4 py-6 text-center rounded-card border bg-[var(--bg-card)] border-[var(--border-c-default)] text-[var(--text-tertiary)]"
          >
            <User size={20} className="mx-auto mb-2 opacity-50" />
            <p className="text-sm">未找到匹配的客户</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
