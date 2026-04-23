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

#import "DirectoryViewDisplaySettings.h"

#import "TreeDrawerBaseSettings.h"
#import "PreferencesPanelControl.h"

@implementation DirectoryViewDisplaySettings

- (instancetype) init {
  NSUserDefaults  *ud = NSUserDefaults.standardUserDefaults;

  return [self initWithColorMappingKey: [ud stringForKey: DefaultColorMappingKey]
                       colorPaletteKey: [ud stringForKey: DefaultColorPaletteKey]
                          drawItemsKey: [ud stringForKey: DefaultDrawItemsKey]
                              maskName: [ud stringForKey: MaskFilterKey]
                           maskEnabled: NO
                      showEntireVolume: [ud boolForKey: ShowEntireVolumeByDefaultKey]];
}

- (instancetype) initWithColorMappingKey:(NSString *)colorMappingKey
                         colorPaletteKey:(NSString *)colorPaletteKey
                            drawItemsKey:(NSString *)drawItemsKey
                                maskName:(NSString *)maskName
                             maskEnabled:(BOOL)maskEnabled
                        showEntireVolume:(BOOL)showEntireVolume {
  if (self = [super init]) {
    _colorMappingKey = [colorMappingKey retain];
    _colorPaletteKey = [colorPaletteKey retain];
    _drawItemsKey = [drawItemsKey retain];
    _maskName = [maskName retain];
    _fileItemMaskEnabled = maskEnabled;
    _showEntireVolume = showEntireVolume;
  }

  return self;
}

- (void) dealloc {
  [_colorMappingKey release];
  [_colorPaletteKey release];
  [_drawItemsKey release];
  [_maskName release];

  [super dealloc];
}

- (id) copyWithZone:(NSZone *)zone {
  return [[[self class] allocWithZone: zone] initWithColorMappingKey: _colorMappingKey
                                                     colorPaletteKey: _colorPaletteKey
                                                        drawItemsKey: _drawItemsKey
                                                            maskName: _maskName
                                                         maskEnabled: _fileItemMaskEnabled
                                                    showEntireVolume: _showEntireVolume];
}

+ (DirectoryViewDisplaySettings *)defaultSettings {
  return [[[DirectoryViewDisplaySettings alloc] init] autorelease];
}

- (BOOL) packagesAsFiles {
  return ![_drawItemsKey isEqualToString: DrawFilesKey];
}

@end
