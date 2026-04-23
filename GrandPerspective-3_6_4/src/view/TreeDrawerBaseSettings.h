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

extern const unsigned MIN_DISPLAY_DEPTH_LIMIT;

// The maximum depth limit, when a limit is applied
extern const unsigned MAX_DISPLAY_DEPTH_LIMIT;

// The depth limit value when there is no depth limiting
extern const unsigned NO_DISPLAY_DEPTH_LIMIT;

typedef NS_ENUM(NSInteger, DrawItemsEnum) {
  DRAW_NONE, // To be used when not set
  DRAW_FILES,
  DRAW_PACKAGES,
  DRAW_FOLDERS,
};

extern NSString* DrawFilesKey;
extern NSString* DrawPackagesKey;
extern NSString* DrawFoldersKey;


@interface TreeDrawerBaseSettings : NSObject {
}

+ (NSArray *)drawItemsNames;
+ (DrawItemsEnum) enumForDrawItemsName:(NSString *)name;
+ (NSString *)nameForDrawItemsEnum:(DrawItemsEnum) value;

// Creates default settings.
- (instancetype) init;

- (instancetype) initWithDisplayDepth:(unsigned)displayDepth
                            drawItems:(DrawItemsEnum)drawItems NS_DESIGNATED_INITIALIZER;

- (instancetype) settingsWithChangedDisplayDepth:(unsigned)displayDepth;
- (instancetype) settingsWithChangedDrawItems:(DrawItemsEnum)drawItems;

// The maximum depth that the drawer visits when drawing the tree. Directories at this depth are
// displayed a single blocks.
@property (nonatomic, readonly) unsigned displayDepth;

@property (nonatomic, readonly) DrawItemsEnum drawItems;

@property (class, nonatomic, readonly) DrawItemsEnum defaultDrawItems;
@property (class, nonatomic, readonly) unsigned defaultDisplayDepth;

@end

NS_ASSUME_NONNULL_END
