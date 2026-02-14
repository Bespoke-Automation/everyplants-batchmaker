'use client'

import { useState, useRef, useCallback, useEffect, forwardRef, useImperativeHandle } from 'react'
import type { PicqerUserItem } from '@/hooks/usePicqerUsers'

interface MentionTextareaProps {
  value: string
  onChange: (value: string) => void
  onKeyDown?: (e: React.KeyboardEvent) => void
  placeholder?: string
  disabled?: boolean
  users: PicqerUserItem[]
  className?: string
}

const MentionTextarea = forwardRef<HTMLTextAreaElement, MentionTextareaProps>(function MentionTextarea({
  value,
  onChange,
  onKeyDown,
  placeholder,
  disabled,
  users,
  className,
}, ref) {
  const [showDropdown, setShowDropdown] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionStart, setMentionStart] = useState(-1)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Forward ref to internal textarea
  useImperativeHandle(ref, () => textareaRef.current!, [])


  const filteredUsers = mentionQuery
    ? users.filter((u) =>
        u.fullName.toLowerCase().includes(mentionQuery.toLowerCase())
      )
    : users

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value
      const cursorPos = e.target.selectionStart

      onChange(newValue)

      // Detect @ mention trigger
      const textBeforeCursor = newValue.slice(0, cursorPos)
      const atIndex = textBeforeCursor.lastIndexOf('@')

      if (atIndex >= 0) {
        const charBefore = atIndex > 0 ? textBeforeCursor[atIndex - 1] : ' '
        const textAfterAt = textBeforeCursor.slice(atIndex + 1)

        // Only trigger if @ is at start or after whitespace, and no space in query
        if ((charBefore === ' ' || charBefore === '\n' || atIndex === 0) && !textAfterAt.includes(' ')) {
          setMentionStart(atIndex)
          setMentionQuery(textAfterAt)
          setShowDropdown(true)
          setSelectedIndex(0)
          return
        }
      }

      setShowDropdown(false)
    },
    [onChange]
  )

  const selectUser = useCallback(
    (user: PicqerUserItem) => {
      if (mentionStart < 0) return

      const before = value.slice(0, mentionStart)
      const after = value.slice(mentionStart + 1 + mentionQuery.length)
      const newValue = `${before}@${user.fullName} ${after}`

      onChange(newValue)
      setShowDropdown(false)
      setMentionQuery('')
      setMentionStart(-1)

      // Refocus textarea
      requestAnimationFrame(() => {
        const textarea = textareaRef.current
        if (textarea) {
          const newPos = mentionStart + user.fullName.length + 2 // @ + name + space
          textarea.focus()
          textarea.setSelectionRange(newPos, newPos)
        }
      })
    },
    [value, onChange, mentionStart, mentionQuery]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (showDropdown && filteredUsers.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setSelectedIndex((prev) => (prev + 1) % filteredUsers.length)
          return
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          setSelectedIndex((prev) => (prev - 1 + filteredUsers.length) % filteredUsers.length)
          return
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault()
          selectUser(filteredUsers[selectedIndex])
          return
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          setShowDropdown(false)
          return
        }
      }

      // Pass through to parent handler
      onKeyDown?.(e)
    },
    [showDropdown, filteredUsers, selectedIndex, selectUser, onKeyDown]
  )

  // Close dropdown on click outside
  useEffect(() => {
    if (!showDropdown) return

    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        textareaRef.current &&
        !textareaRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showDropdown])

  return (
    <div className="relative flex-1">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={1}
        className={
          className ??
          'w-full resize-none border border-border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary min-h-[36px] max-h-[100px]'
        }
        disabled={disabled}
      />
      {showDropdown && filteredUsers.length > 0 && (
        <div
          ref={dropdownRef}
          className="absolute bottom-full left-0 mb-1 w-full max-h-[180px] overflow-y-auto bg-card border border-border rounded-lg shadow-lg z-50"
        >
          {filteredUsers.slice(0, 8).map((user, index) => (
            <button
              key={user.iduser}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault()
                selectUser(user)
              }}
              className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                index === selectedIndex
                  ? 'bg-primary/10 text-primary'
                  : 'hover:bg-muted'
              }`}
            >
              {user.fullName}
            </button>
          ))}
        </div>
      )}
    </div>
  )
})

export default MentionTextarea
