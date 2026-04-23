/* GrandPerspective, Version 3.6.4 
 *   A utility for macOS that graphically shows disk usage. 
 * Copyright (C) 2005-2025, Erwin Bonsma 
 * 
 * This program is free software; you can redistribute it and/or modify it 
 * under the terms of the GNU General Public License as published by the Free 
 * Software Foundation; either version 2 of the License, or (at your option) 
 * any later version. 
 * 
 * This program is distributed in the hope that it will be useful, but WITHOUT 
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or 
 * FITNESS FOR A PARTICULAR PURPOSE.  See the GNU General Public License for 
 * more details. 
 * 
 * You should have received a copy of the GNU General Public License along 
 * with this program; if not, write to the Free Software Foundation, Inc., 
 * 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA. 
 */

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

typedef NS_OPTIONS(UInt8, RawTreeColumnFlags) {
  ColumnPath             = 0x01,
  ColumnName             = 0x02,
  ColumnSize             = 0x04,
  ColumnType             = 0x08,
  ColumnCreationTime     = 0x10,
  ColumnModificationTime = 0x20,
  ColumnAccessTime       = 0x40
};

@interface RawTreeWriterOptions : NSObject {
  RawTreeColumnFlags  columnFlags;
}

@property (nonatomic, readwrite) BOOL headersEnabled;

// Constructs instance with default settings
- (id)init;

+ (RawTreeWriterOptions *)defaultOptions;

// Toggle given column(s) so that they are output
- (void)showColumn:(RawTreeColumnFlags)flags;

// Toggle given column(s) so that they are hidden
- (void)hideColumn:(RawTreeColumnFlags)flags;

// Returns YES if the given column is shown (or if more flags are set, all given columns are shown)
- (BOOL)isColumnShown:(RawTreeColumnFlags)flags;

@end

NS_ASSUME_NONNULL_END
