'use client'

import { type CSSProperties } from 'react'
import { type Header, flexRender } from '@tanstack/react-table'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ArrowUpDown, ArrowUp, ArrowDown, GripVertical } from 'lucide-react'
import type { BestellijstRow } from '@/app/api/bestellijst/route'

interface Props {
  header: Header<BestellijstRow, unknown>
}

export default function DraggableColumnHeader({ header }: Props) {
  const { column } = header
  const sorted = column.getIsSorted()
  const align = column.columnDef.meta?.align
  const pinned = column.columnDef.meta?.pinned

  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({
    id: column.id,
    disabled: !!pinned,
  })

  const style: CSSProperties = {
    width: header.getSize(),
    position: pinned ? 'sticky' : 'relative',
    left: pinned ? 0 : undefined,
    zIndex: isDragging ? 50 : pinned ? 20 : undefined,
    whiteSpace: 'nowrap',
    userSelect: 'none',
    transform: CSS.Translate.toString(transform),
    transition: transition || undefined,
    opacity: isDragging ? 0.5 : 1,
  }

  const SortIcon = () => {
    if (!sorted) return <ArrowUpDown className="w-3.5 h-3.5 text-muted-foreground/50" />
    return sorted === 'asc'
      ? <ArrowUp className="w-3.5 h-3.5 text-primary" />
      : <ArrowDown className="w-3.5 h-3.5 text-primary" />
  }

  return (
    <th
      ref={setNodeRef}
      style={style}
      className={`px-3 py-2.5 font-medium transition-colors ${
        pinned ? 'bg-muted/50' : ''
      } ${align === 'right' ? 'text-right' : 'text-left'} ${
        isDragging ? 'bg-primary/10 shadow-md rounded-sm' : ''
      } ${isOver && !isDragging ? 'bg-accent' : ''} ${
        !isDragging && !pinned ? 'hover:bg-muted/80' : ''
      }`}
    >
      <span className="inline-flex items-center gap-1">
        {!pinned && (
          <button
            ref={setActivatorNodeRef}
            {...listeners}
            {...attributes}
            className="cursor-grab active:cursor-grabbing p-0.5 -ml-1 rounded hover:bg-muted text-muted-foreground/40 hover:text-muted-foreground transition-colors"
            type="button"
          >
            <GripVertical className="w-3.5 h-3.5" />
          </button>
        )}
        <span
          className="inline-flex items-center gap-1 cursor-pointer"
          onClick={column.getToggleSortingHandler()}
        >
          {flexRender(column.columnDef.header, header.getContext())}
          <SortIcon />
        </span>
      </span>

      {/* Resize handle */}
      <div
        onMouseDown={(e) => {
          e.stopPropagation()
          header.getResizeHandler()(e)
        }}
        onTouchStart={(e) => {
          e.stopPropagation()
          header.getResizeHandler()(e)
        }}
        className={`absolute right-0 top-0 h-full w-1 cursor-col-resize select-none touch-none ${
          header.column.getIsResizing() ? 'bg-primary' : 'hover:bg-primary/50'
        }`}
      />

      {/* Drop indicator line */}
      {isOver && !isDragging && (
        <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-primary rounded-full" />
      )}
    </th>
  )
}
