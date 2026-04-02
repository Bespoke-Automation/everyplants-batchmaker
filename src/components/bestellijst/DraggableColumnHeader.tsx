'use client'

import { type CSSProperties } from 'react'
import { type Header, flexRender } from '@tanstack/react-table'
import { useSortable } from '@dnd-kit/sortable'
import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react'
import type { BestellijstRow } from '@/app/api/bestellijst/route'

interface Props {
  header: Header<BestellijstRow, unknown>
}

export default function DraggableColumnHeader({ header }: Props) {
  const { column } = header
  const sorted = column.getIsSorted()
  const align = column.columnDef.meta?.align

  const {
    attributes,
    listeners,
    setNodeRef,
    isDragging,
  } = useSortable({ id: column.id })

  const style: CSSProperties = {
    width: header.getSize(),
    opacity: isDragging ? 0.4 : 1,
    position: 'relative',
    whiteSpace: 'nowrap',
    userSelect: 'none',
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
      className={`px-3 py-2.5 font-medium cursor-grab hover:bg-muted/80 transition-colors ${
        align === 'right' ? 'text-right' : 'text-left'
      }`}
      {...attributes}
      {...listeners}
    >
      <span
        className="inline-flex items-center gap-1 cursor-pointer"
        onClick={column.getToggleSortingHandler()}
      >
        {flexRender(column.columnDef.header, header.getContext())}
        <SortIcon />
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
    </th>
  )
}
