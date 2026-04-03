'use client'

import { type CSSProperties } from 'react'
import { type Header, flexRender } from '@tanstack/react-table'
import { useDraggable, useDroppable } from '@dnd-kit/core'
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

  const { setNodeRef: setDraggableRef, listeners, attributes, isDragging } = useDraggable({
    id: `drag-${column.id}`,
    data: { columnId: column.id },
    disabled: !!pinned,
  })

  const { setNodeRef: setDroppableRef, isOver } = useDroppable({
    id: `drop-${column.id}`,
    data: { columnId: column.id },
    disabled: !!pinned,
  })

  const style: CSSProperties = {
    width: header.getSize(),
    opacity: isDragging ? 0.4 : 1,
    position: pinned ? 'sticky' : 'relative',
    left: pinned ? 0 : undefined,
    zIndex: pinned ? 20 : undefined,
    whiteSpace: 'nowrap',
    userSelect: 'none',
    background: isOver ? 'var(--color-muted)' : undefined,
  }

  const SortIcon = () => {
    if (!sorted) return <ArrowUpDown className="w-3.5 h-3.5 text-muted-foreground/50" />
    return sorted === 'asc'
      ? <ArrowUp className="w-3.5 h-3.5 text-primary" />
      : <ArrowDown className="w-3.5 h-3.5 text-primary" />
  }

  return (
    <th
      ref={setDroppableRef}
      style={style}
      className={`px-3 py-2.5 font-medium hover:bg-muted/80 transition-colors ${
        pinned ? 'bg-muted/50' : ''
      } ${align === 'right' ? 'text-right' : 'text-left'}`}
    >
      <span className="inline-flex items-center gap-1">
        {!pinned && (
          <button
            ref={setDraggableRef}
            {...listeners}
            {...attributes}
            className="cursor-grab active:cursor-grabbing p-0.5 -ml-1 rounded hover:bg-muted text-muted-foreground/40 hover:text-muted-foreground"
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
    </th>
  )
}
