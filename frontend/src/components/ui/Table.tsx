import { ReactNode } from 'react';
import { clsx } from 'clsx';

interface Column<T> {
  key: keyof T | string;
  header: string;
  render?: (item: T) => ReactNode;
  className?: string;
}

interface TableProps<T> {
  data: T[];
  columns: Column<T>[];
  emptyMessage?: string;
  onRowClick?: (item: T) => void;
}

export function Table<T extends Record<string, any>>({
  data,
  columns,
  emptyMessage = 'No data available',
  onRowClick,
}: TableProps<T>) {
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            {columns.map((column, index) => (
              <th
                key={index}
                className={clsx(
                  'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider',
                  column.className
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {data.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-6 py-12 text-center text-gray-500">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            data.map((item, rowIndex) => (
              <tr
                key={rowIndex}
                onClick={() => onRowClick?.(item)}
                className={clsx({
                  'hover:bg-gray-50 cursor-pointer transition-colors': onRowClick,
                })}
              >
                {columns.map((column, colIndex) => (
                  <td key={colIndex} className={clsx('px-6 py-4 whitespace-nowrap text-sm', column.className)}>
                    {column.render ? column.render(item) : item[column.key as keyof T]}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
