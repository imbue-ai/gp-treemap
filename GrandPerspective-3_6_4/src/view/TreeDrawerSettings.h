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

#import "TreeDrawerBaseSettings.h"

@protocol FileItemMappingScheme;
@class FileItemTest;


/* Settings for TreeDrawer objects. The settings are immutable, to facilitate use in multi-threading
 * context.
 */
@interface TreeDrawerSettings : TreeDrawerBaseSettings {
}

- (instancetype) initWithColorScheme:(NSObject <FileItemMappingScheme> *)colorScheme
                        colorPalette:(NSColorList *)colorPalette
                       colorGradient:(float)colorGradient
                           drawItems:(DrawItemsEnum)drawItems
                            maskTest:(FileItemTest *)maskTest
                        displayDepth:(unsigned)displayDepth NS_DESIGNATED_INITIALIZER;

- (instancetype) settingsWithChangedColorScheme:(NSObject <FileItemMappingScheme> *)colorScheme;
- (instancetype) settingsWithChangedColorPalette:(NSColorList *)colorPalette;
- (instancetype) settingsWithChangedColorGradient:(float)colorGradient;
- (instancetype) settingsWithChangedMaskTest:(FileItemTest *)maskTest;

@property (nonatomic, readonly, strong) NSObject<FileItemMappingScheme> *colorScheme;
@property (nonatomic, readonly, strong) NSColorList *colorPalette;
@property (nonatomic, readonly) float colorGradient;
@property (nonatomic, readonly, strong) FileItemTest *maskTest;

@end
