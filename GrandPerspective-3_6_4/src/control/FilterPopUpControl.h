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

extern NSString  *SelectedFilterRenamed;
extern NSString  *SelectedFilterRemoved;
extern NSString  *SelectedFilterUpdated;

@class FilterRepository;
@class UniqueTagsTransformer;

/* Controller for a pop-up button for selecting the filters in the filter repository. It observes
 * the repository and updates the button when filters are added, removed or renamed. It also fires
 * events itself when the selected filter is either renamed, removed or updated. Where available,
 * the pop-up shows the localized names of the filters.
 */
@interface FilterPopUpControl : NSObject {
  NSPopUpButton  *popUpButton;
  FilterRepository  *filterRepository;
  UniqueTagsTransformer  *tagMaker;
  
  NSNotificationCenter  *notificationCenter;
}

// Overrides designated initialiser.
- (instancetype) init NS_UNAVAILABLE;

- (instancetype) initWithPopUpButton:(NSPopUpButton *)popUpButton;

- (instancetype) initWithPopUpButton:(NSPopUpButton *)popUpButton
                    filterRepository:(FilterRepository *)filterRepository;

- (instancetype) initWithPopUpButton:(NSPopUpButton *)popUpButton
                    filterRepository:(FilterRepository *)filterRepository
                          noneOption:(BOOL)noneOption NS_DESIGNATED_INITIALIZER;

@property (nonatomic, strong) NSNotificationCenter *notificationCenter;

/* Returns the locale-independent name of the selected filter.
 */
@property (nonatomic, readonly, copy) NSString *selectedFilterName;

/* Selects the filter with the given locale-independent name.
 */
- (void) selectFilterNamed:(NSString *)name;

@end
