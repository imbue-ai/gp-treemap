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

#import <Cocoa/Cocoa.h>

#include "TreeDrawerBase.h"

@class TreeDrawerSettings;
@class FileItemTest;
@class FileItemMapping;
@protocol FileItemMappingScheme;

/* Event fired when the color mapper has changed. This is the case when the color mapping scheme
 * changed, or when the scheme changed the way it maps file items to hash values.
 */
extern NSString  *ColorMappingChangedEvent;

@interface TreeDrawer : TreeDrawerBase {
//  NSObject <FileItemMappingScheme>  *colorScheme;
  
  UInt32  freeSpaceColor;
  UInt32  usedSpaceColor;
  UInt32  visibleTreeBackgroundColor;
}

- (instancetype) initWithScanTree:(DirectoryItem *)scanTree
               treeDrawerSettings:(TreeDrawerSettings *)settings NS_DESIGNATED_INITIALIZER;

@property (nonatomic, strong) FileItemTest *maskTest;

@property (nonatomic, strong) NSObject<FileItemMappingScheme> *colorScheme;
@property (nonatomic, strong) FileItemMapping *colorMapper;

@end
