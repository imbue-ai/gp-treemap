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

@class FilterSet;
@class DirectoryItem;


@interface ScanTaskInput : NSObject {
}

// Overrides designated initialiser
- (instancetype) init NS_UNAVAILABLE;

- (instancetype) initWithPath:(NSString *)path
              fileSizeMeasure:(NSString *)measure
                    filterSet:(FilterSet *)filterSet;

- (instancetype) initWithTreeSource:(DirectoryItem *)treeSource
                    fileSizeMeasure:(NSString *)measure
                          filterSet:(FilterSet *)filterSet;

- (instancetype) initWithPath:(NSString *)path
              fileSizeMeasure:(NSString *)measure
                    filterSet:(FilterSet *)filterSet
                   treeSource:(DirectoryItem *)treeSource NS_DESIGNATED_INITIALIZER;

@property (nonatomic, readonly, copy) NSString *path;
@property (nonatomic, readonly, copy) NSString *fileSizeMeasure;
@property (nonatomic, readonly, strong) FilterSet *filterSet;

// Optional: When not nil, the scan should use this as source and only scan/refresh the outdated
// directories, as indicated by their rescanFlags.
@property (nonatomic, readonly, strong) DirectoryItem *treeSource;

@end
